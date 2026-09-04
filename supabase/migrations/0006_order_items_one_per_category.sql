-- =============================================================
-- One order may now carry one item from EACH menu category, all from the
-- same restaurant.
--
--   order_items                    one row per chosen item
--   UNIQUE (order_id, category_id) NULLS NOT DISTINCT — max one per category
--   orders.total_price             kept in step by a trigger, never by the client
--
-- The per-event duplicate rule (one order per phone / per email) is untouched.
-- Existing orders are preserved and backfilled into order_items.
--
-- Safe to re-run.
-- =============================================================

-- =============================================================
-- 1. order_items
-- =============================================================
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete restrict,
  -- Snapshot of the category the item was in when it was ordered, so the
  -- one-per-category rule cannot be rewritten by later menu edits.
  category_id  uuid references public.menu_categories (id) on delete set null,
  -- price + names snapshotted from the database at creation time (never the client)
  unit_price   numeric(10, 2) not null check (unit_price >= 0),
  item_name_en text not null,
  item_name_ar text not null,
  created_at   timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_menu_item_idx on public.order_items (menu_item_id);

-- THE new business rule, enforced by the database. NULLS NOT DISTINCT so that
-- uncategorised items collapse to a single slot too, instead of being unbounded.
create unique index if not exists order_items_one_per_category
  on public.order_items (order_id, category_id) nulls not distinct;

-- The same dish cannot be added twice to one order.
create unique index if not exists order_items_unique_item
  on public.order_items (order_id, menu_item_id);

-- =============================================================
-- 2. orders.total_price
-- =============================================================
alter table public.orders add column if not exists total_price numeric(10, 2);

comment on column public.orders.total_price is
  'Sum of order_items.unit_price. Maintained by trigger — never supplied by a client.';
comment on column public.orders.unit_price is
  'Price of the primary (most expensive) item. Kept for the admin list, reports and history.';

-- ---------- backfill: every historical order becomes a one-item order -------
insert into public.order_items (order_id, menu_item_id, category_id, unit_price, item_name_en, item_name_ar)
select o.id, o.menu_item_id, mi.category_id, o.unit_price, o.item_name_en, o.item_name_ar
from public.orders o
left join public.menu_items mi on mi.id = o.menu_item_id
where not exists (select 1 from public.order_items oi where oi.order_id = o.id);

update public.orders set total_price = unit_price where total_price is null;
alter table public.orders alter column total_price set not null;
-- A default keeps direct inserts working; the trigger below makes it true.
alter table public.orders alter column total_price set default 0;

-- ---------- the total is derived, never asserted ----------
create or replace function public.orders_sync_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
  set total_price = coalesce(
    (select sum(oi.unit_price) from public.order_items oi where oi.order_id = v_order), 0
  )
  where o.id = v_order;
  return null;
end;
$$;

drop trigger if exists order_items_sync_total on public.order_items;
create trigger order_items_sync_total
  after insert or update or delete on public.order_items
  for each row execute function public.orders_sync_total();

-- =============================================================
-- 3. order_payload now carries every item and the total
-- =============================================================
create or replace function public.order_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'unit_price', o.unit_price,
    'total_price', o.total_price,
    'created_at', o.created_at,
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name_en', e.name_en, 'name_ar', e.name_ar),
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name_en', r.name_en, 'name_ar', r.name_ar),
    -- kept for callers that still expect a single headline item
    'item', jsonb_build_object('id', o.menu_item_id, 'name_en', o.item_name_en, 'name_ar', o.item_name_ar),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', oi.menu_item_id,
                 'category_id', oi.category_id,
                 'name_en', oi.item_name_en,
                 'name_ar', oi.item_name_ar,
                 'unit_price', oi.unit_price
               ) order by oi.unit_price desc, oi.item_name_en
             )
      from public.order_items oi where oi.order_id = o.id
    ), '[]'::jsonb),
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone)
  )
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.restaurants r on r.id = o.restaurant_id
  join public.customers c on c.id = o.customer_id
  where o.id = p_order_id;
$$;

grant execute on function public.order_payload(uuid) to service_role;

-- =============================================================
-- 4. place_order accepts a set of items
-- =============================================================
drop function if exists public.place_order(uuid, text, text, uuid, uuid, text, text, text);

create or replace function public.place_order(
  p_auth_user_id  uuid,
  p_phone         text,
  p_event_slug    text,
  p_restaurant_id uuid,
  p_menu_item_ids uuid[],
  p_name          text,
  p_email         text,
  p_device_id     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event      public.events%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_item       public.menu_items%rowtype;
  v_customer   public.customers%rowtype;
  v_order      public.orders%rowtype;
  v_primary    public.menu_items%rowtype;
  v_total      numeric(10, 2) := 0;
  v_ids        uuid[];
  v_id         uuid;
  v_categories uuid[] := '{}';
  v_saw_uncategorised boolean := false;
  v_name       text := btrim(coalesce(p_name, ''));
  v_email      text := public.normalize_email(p_email);
  v_phone      text := public.normalize_saudi_phone(p_phone);
  v_device     text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  if p_auth_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if v_phone is null then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;

  if length(v_name) < 2 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;

  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  -- 0. the selection itself. Duplicates are collapsed before anything else so
  --    a repeated id can never be mistaken for two choices.
  select array_agg(distinct id) into v_ids
  from unnest(coalesce(p_menu_item_ids, '{}'::uuid[])) as id
  where id is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'NO_ITEMS_SELECTED' using errcode = 'P0001';
  end if;
  if array_length(v_ids, 1) > 20 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;

  -- 1. event must exist, be active, and be within its date window
  select * into v_event from public.events where slug = p_event_slug;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_event.status <> 'active'
     or (v_event.start_date is not null and now() < v_event.start_date)
     or (v_event.end_date is not null and now() > v_event.end_date) then
    raise exception 'EVENT_INACTIVE' using errcode = 'P0001';
  end if;

  -- 2. restaurant must exist, be active, and take part in this event
  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_restaurant.status <> 'active' then
    raise exception 'RESTAURANT_DISABLED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.event_restaurants
    where event_id = v_event.id and restaurant_id = v_restaurant.id
  ) then
    raise exception 'RESTAURANT_NOT_IN_EVENT' using errcode = 'P0001';
  end if;

  -- 3. every item: exists, belongs to THIS restaurant, is available, and holds
  --    the only slot for its category. The client's claims are never consulted.
  foreach v_id in array v_ids loop
    select * into v_item from public.menu_items where id = v_id;
    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_item.restaurant_id <> v_restaurant.id then
      raise exception 'ITEM_RESTAURANT_MISMATCH' using errcode = 'P0001';
    end if;
    if not v_item.is_available then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
    end if;

    -- one item per category; an uncategorised item is a single slot of its own
    if v_item.category_id is null then
      if v_saw_uncategorised then
        raise exception 'DUPLICATE_CATEGORY' using errcode = 'P0001';
      end if;
      v_saw_uncategorised := true;
    elsif v_item.category_id = any (v_categories) then
      raise exception 'DUPLICATE_CATEGORY' using errcode = 'P0001';
    else
      v_categories := v_categories || v_item.category_id;
    end if;

    -- 4. price comes from the database, and the total is summed here
    v_total := v_total + v_item.price;

    -- the headline item is the most expensive one, chosen deterministically
    if v_primary.id is null
       or v_item.price > v_primary.price
       or (v_item.price = v_primary.price and v_item.id < v_primary.id) then
      v_primary := v_item;
    end if;
  end loop;

  -- 5. THE duplicate rule: one order per event per phone OR per email.
  select * into v_order
  from public.orders
  where event_id = v_event.id
    and (normalized_phone = v_phone or normalized_email = v_email)
  order by created_at
  limit 1;

  if found then
    perform public.log_duplicate_attempt(
      p_auth_user_id, v_order, v_phone, v_email, v_device, v_restaurant.id, v_primary.id, false
    );
    return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
  end if;

  -- 6. customer directory row, matched on the phone identity key
  insert into public.customers (name, email, phone)
  values (v_name, v_email, v_phone)
  on conflict (phone) do update
    set name       = excluded.name,
        email      = excluded.email,
        updated_at = now()
  returning * into v_customer;

  -- 7. create the order and its items in one transaction
  begin
    insert into public.orders (
      order_number, event_id, customer_id, restaurant_id, menu_item_id,
      unit_price, total_price, item_name_en, item_name_ar, status,
      normalized_phone, normalized_email, auth_user_id, device_id
    ) values (
      public.next_order_number(v_event.order_prefix),
      v_event.id, v_customer.id, v_restaurant.id, v_primary.id,
      v_primary.price, v_total, v_primary.name_en, v_primary.name_ar, 'new',
      v_phone, v_email, p_auth_user_id, v_device
    )
    returning * into v_order;
  exception when unique_violation then
    -- lost a race against a concurrent submission: return the winner
    select * into v_order
    from public.orders
    where event_id = v_event.id
      and (normalized_phone = v_phone or normalized_email = v_email)
    order by created_at
    limit 1;

    if found then
      perform public.log_duplicate_attempt(
        p_auth_user_id, v_order, v_phone, v_email, v_device, v_restaurant.id, v_primary.id, true
      );
      return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
    end if;
    raise;
  end;

  -- The unique index on (order_id, category_id) is the real guarantee here;
  -- the loop above only exists to raise a readable error first.
  insert into public.order_items (order_id, menu_item_id, category_id, unit_price, item_name_en, item_name_ar)
  select v_order.id, mi.id, mi.category_id, mi.price, mi.name_en, mi.name_ar
  from public.menu_items mi
  where mi.id = any (v_ids);

  return jsonb_build_object('result', 'created', 'order', public.order_payload(v_order.id));
end;
$$;

revoke all on function public.place_order(uuid, text, text, uuid, uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, uuid, uuid[], text, text, text)
  to service_role;

-- =============================================================
-- 5. RLS — order_items follow the order they belong to
-- =============================================================
alter table public.order_items enable row level security;

drop policy if exists order_items_self_read on public.order_items;
create policy order_items_self_read on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.auth_user_id = auth.uid() or o.customer_id = public.current_customer_id())
    )
  );

drop policy if exists order_items_admin_all on public.order_items;
create policy order_items_admin_all on public.order_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =============================================================
-- 6. Realtime
-- =============================================================
do $$ begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null; end $$;
