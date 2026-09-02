-- =============================================================
-- Business logic: order placement, status transitions, notifications
-- =============================================================

-- ---------- admin check (security definer avoids RLS recursion) ----------
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'admin'
  );
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;

-- ---------- id of the customer row owned by the current auth user ----------
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.customers where auth_user_id = auth.uid();
$$;

grant execute on function public.current_customer_id() to authenticated, service_role;

-- ---------- human readable order number ----------
create or replace function public.next_order_number(p_prefix text)
returns text
language sql
volatile
as $$
  select coalesce(nullif(btrim(p_prefix), ''), 'A') || '-' || nextval('public.order_number_seq')::text;
$$;

-- ---------- denormalized order view payload ----------
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
    'created_at', o.created_at,
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name_en', e.name_en, 'name_ar', e.name_ar),
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name_en', r.name_en, 'name_ar', r.name_ar),
    'item', jsonb_build_object('id', o.menu_item_id, 'name_en', o.item_name_en, 'name_ar', o.item_name_ar),
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
-- place_order: the single authoritative order-creation entry point.
-- Runs as one transaction. Never trusts client-supplied prices or ids
-- beyond using them as lookup keys, and re-validates everything.
-- Returns jsonb: { result: 'created' | 'duplicate', order: {...} }
-- =============================================================
create or replace function public.place_order(
  p_auth_user_id uuid,
  p_phone        text,
  p_event_slug   text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid,
  p_name         text,
  p_email        text
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
  v_name       text := btrim(coalesce(p_name, ''));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_phone      text := btrim(coalesce(p_phone, ''));
begin
  if p_auth_user_id is null then
    raise exception 'NOT_VERIFIED' using errcode = 'P0001';
  end if;

  if v_phone !~ '^\+9665[0-9]{8}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;

  if length(v_name) < 2 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
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

  -- 3. menu item must exist, be available, and belong to that restaurant
  select * into v_item from public.menu_items where id = p_menu_item_id;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_item.restaurant_id <> v_restaurant.id then
    raise exception 'ITEM_RESTAURANT_MISMATCH' using errcode = 'P0001';
  end if;
  if not v_item.is_available then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- 4. customer: matched on the normalized phone, which is the identity key.
  --    Concurrent callers serialize on the unique phone index.
  insert into public.customers (auth_user_id, name, email, phone, phone_verified)
  values (p_auth_user_id, v_name, v_email, v_phone, true)
  on conflict (phone) do update
    set auth_user_id   = coalesce(public.customers.auth_user_id, excluded.auth_user_id),
        name           = excluded.name,
        email          = excluded.email,
        phone_verified = true,
        updated_at     = now()
  returning * into v_customer;

  -- 5. one order per customer per event
  select * into v_order
  from public.orders
  where event_id = v_event.id and customer_id = v_customer.id;

  if found then
    -- Record the attempt so staff can see that this guest tried again, and
    -- what they tried to order, without a second order ever being created.
    insert into public.admin_audit_logs (user_id, action, entity, entity_id, meta)
    values (
      p_auth_user_id, 'order.duplicate_attempt', 'orders', v_order.id::text,
      jsonb_build_object(
        'customer_id', v_customer.id,
        'phone', v_phone,
        'existing_order_number', v_order.order_number,
        'attempted_restaurant_id', v_restaurant.id,
        'attempted_menu_item_id', v_item.id,
        'attempted_item_name', v_item.name_en
      )
    );

    return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
  end if;

  -- 6. create the order using the authoritative database price
  begin
    insert into public.orders (
      order_number, event_id, customer_id, restaurant_id, menu_item_id,
      unit_price, item_name_en, item_name_ar, status
    ) values (
      public.next_order_number(v_event.order_prefix),
      v_event.id, v_customer.id, v_restaurant.id, v_item.id,
      v_item.price, v_item.name_en, v_item.name_ar, 'new'
    )
    returning * into v_order;
  exception when unique_violation then
    -- lost a race against a concurrent submission: return the winner
    select * into v_order
    from public.orders
    where event_id = v_event.id and customer_id = v_customer.id;
    if found then
      insert into public.admin_audit_logs (user_id, action, entity, entity_id, meta)
      values (
        p_auth_user_id, 'order.duplicate_attempt', 'orders', v_order.id::text,
        jsonb_build_object(
          'customer_id', v_customer.id,
          'phone', v_phone,
          'existing_order_number', v_order.order_number,
          'concurrent', true
        )
      );
      return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
    end if;
    raise;
  end;

  return jsonb_build_object('result', 'created', 'order', public.order_payload(v_order.id));
end;
$$;

revoke all on function public.place_order(uuid, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, uuid, uuid, text, text) to service_role;

-- =============================================================
-- Status transitions
-- =============================================================
create or replace function public.log_order_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer text;
  v_restaurant text;
begin
  insert into public.order_status_history (order_id, from_status, to_status, note)
  values (new.id, null, new.status, 'Order received');

  select c.name into v_customer from public.customers c where c.id = new.customer_id;
  select r.name_en into v_restaurant from public.restaurants r where r.id = new.restaurant_id;

  insert into public.notifications (type, title, body, order_id)
  values (
    'order.created',
    'New order ' || new.order_number,
    coalesce(v_customer, 'Customer') || ' · ' || coalesce(v_restaurant, 'Restaurant')
      || ' · ' || new.item_name_en || ' · SAR ' || to_char(new.unit_price, 'FM999990.00'),
    new.id
  );
  return new;
end;
$$;

drop trigger if exists orders_created_log on public.orders;
create trigger orders_created_log
  after insert on public.orders
  for each row execute function public.log_order_created();

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), new.cancel_reason);

    if new.status = 'cancelled' then
      insert into public.notifications (type, title, body, order_id)
      values ('order.cancelled', 'Order ' || new.order_number || ' cancelled',
              coalesce(new.cancel_reason, 'Cancelled by admin'), new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_log on public.orders;
create trigger orders_status_log
  after update of status on public.orders
  for each row execute function public.log_order_status_change();

-- ---------- notify when a restaurant is disabled ----------
create or replace function public.log_restaurant_disabled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'disabled' and old.status is distinct from new.status then
    insert into public.notifications (type, title, body)
    values ('restaurant.disabled', 'Restaurant disabled',
            new.name_en || ' is no longer accepting new orders.');
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_disabled_log on public.restaurants;
create trigger restaurants_disabled_log
  after update of status on public.restaurants
  for each row execute function public.log_restaurant_disabled();

-- =============================================================
-- Realtime
-- =============================================================
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

alter table public.orders replica identity full;
