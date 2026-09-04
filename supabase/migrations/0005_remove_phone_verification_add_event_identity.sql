-- =============================================================
-- Removes phone verification and moves duplicate protection onto the
-- order itself, keyed by the normalized phone AND the normalized email.
--
--   UNIQUE (event_id, normalized_phone)
--   UNIQUE (event_id, normalized_email)
--
-- Historical orders are preserved and backfilled. If existing data cannot
-- satisfy the new constraints this migration raises with the exact
-- conflicting rows instead of deleting anything.
--
-- Safe to re-run.
-- =============================================================

-- =============================================================
-- 1. Shared normalization, mirroring src/lib/phone and src/lib/email
-- =============================================================

-- Reduces any accepted Saudi input format to E.164 (+9665XXXXXXXX).
-- Returns null when the input is not a valid Saudi mobile number.
-- Accepted: +9665XXXXXXXX, 009665XXXXXXXX, 9665XXXXXXXX, 05XXXXXXXX, 5XXXXXXXX
-- with any spacing, dashes, dots, parentheses or Arabic-Indic digits.
create or replace function public.normalize_saudi_phone(p_input text)
returns text
language plpgsql
immutable
as $$
declare
  v          text;
  v_national text;
begin
  if p_input is null then
    return null;
  end if;

  -- Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits -> ASCII
  v := translate(p_input, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');

  -- Separators and bidi marks. `translate` with an empty target deletes them.
  v := translate(v, ' ()-.' || chr(9) || chr(160) || chr(8206) || chr(8207), '');

  if v = '' then
    return null;
  end if;

  if left(v, 2) = '00' then
    v := '+' || substr(v, 3);
  end if;

  if left(v, 4) = '+966' then
    v_national := substr(v, 5);
  elsif left(v, 3) = '966' then
    v_national := substr(v, 4);
  elsif left(v, 1) = '0' then
    v_national := substr(v, 2);
  else
    v_national := v;
  end if;

  -- Nine digits, "5" then an assigned operator digit (everything but 2).
  if v_national !~ '^5[013-9][0-9]{7}$' then
    return null;
  end if;

  return '+966' || v_national;
end;
$$;

-- trim + lowercase, and nothing else: no gmail dot/plus folding, so the
-- value stays predictable and matches what the application computes.
create or replace function public.normalize_email(p_input text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_input, ''))), '');
$$;

grant execute on function public.normalize_saudi_phone(text) to anon, authenticated, service_role;
grant execute on function public.normalize_email(text) to anon, authenticated, service_role;

-- =============================================================
-- 2. The order carries the identity the duplicate rule is keyed on
-- =============================================================
alter table public.orders
  add column if not exists normalized_phone text,
  add column if not exists normalized_email text,
  add column if not exists auth_user_id     uuid references auth.users (id) on delete set null,
  add column if not exists device_id        text;

comment on column public.orders.normalized_phone is
  'Snapshot of the ordering guest''s phone in E.164. Half of the per-event duplicate key.';
comment on column public.orders.normalized_email is
  'Snapshot of the ordering guest''s trimmed, lowercased email. Half of the per-event duplicate key.';
comment on column public.orders.auth_user_id is
  'Supabase anonymous auth user that placed the order. Used by RLS for "read my own order".';
comment on column public.orders.device_id is
  'Persistent browser identifier (roshn_event_device_id). Secondary signal only, never a business rule.';

-- ---------- backfill from the customer the order already points at ----------
update public.orders o
set normalized_phone = coalesce(o.normalized_phone, public.normalize_saudi_phone(c.phone), c.phone),
    normalized_email = coalesce(o.normalized_email, public.normalize_email(c.email), c.email),
    auth_user_id     = coalesce(o.auth_user_id, c.auth_user_id)
from public.customers c
where c.id = o.customer_id
  and (o.normalized_phone is null or o.normalized_email is null or o.auth_user_id is null);

-- ---------- refuse to continue rather than destroy conflicting history ------
do $$
declare
  v_report text;
begin
  select string_agg(line, E'\n')
  into v_report
  from (
    select format(
             '  event %s: %s orders share the phone %s (%s)',
             event_id, count(*), normalized_phone, string_agg(order_number, ', ' order by order_number)
           ) as line
    from public.orders
    where normalized_phone is not null
    group by event_id, normalized_phone
    having count(*) > 1

    union all

    select format(
             '  event %s: %s orders share the email %s (%s)',
             event_id, count(*), normalized_email, string_agg(order_number, ', ' order by order_number)
           )
    from public.orders
    where normalized_email is not null
    group by event_id, normalized_email
    having count(*) > 1
  ) conflicts;

  if v_report is not null then
    raise exception
      'Existing orders violate the new per-event identity rule. No data was changed. Resolve these first:%s%s',
      E'\n', v_report
      using errcode = 'unique_violation';
  end if;
end $$;

alter table public.orders alter column normalized_phone set not null;
alter table public.orders alter column normalized_email set not null;

-- ---------- THE business rule, enforced by the database ----------
create unique index if not exists orders_event_phone_key
  on public.orders (event_id, normalized_phone);
create unique index if not exists orders_event_email_key
  on public.orders (event_id, normalized_email);

create index if not exists orders_auth_user_idx on public.orders (auth_user_id);
create index if not exists orders_device_idx on public.orders (device_id);

-- ---------- keep the key normalized however the row is written ----------
-- Belt and braces: even an admin inserting directly cannot store a raw
-- "0551234567" that would slip past the unique index.
create or replace function public.orders_normalize_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
begin
  select * into v_customer from public.customers where id = new.customer_id;

  new.normalized_phone := coalesce(
    public.normalize_saudi_phone(new.normalized_phone),
    new.normalized_phone,
    public.normalize_saudi_phone(v_customer.phone),
    v_customer.phone
  );

  new.normalized_email := coalesce(
    public.normalize_email(new.normalized_email),
    public.normalize_email(v_customer.email),
    v_customer.email
  );

  return new;
end;
$$;

drop trigger if exists orders_normalize_identity on public.orders;
create trigger orders_normalize_identity
  before insert or update of normalized_phone, normalized_email, customer_id on public.orders
  for each row execute function public.orders_normalize_identity();

-- =============================================================
-- 3. Retire the phone-verification flag
-- =============================================================
-- Nothing verifies a phone any more: the number is collected as a customer
-- identifier only. The customer rows themselves are untouched.
alter table public.customers drop column if exists phone_verified;

-- =============================================================
-- 4. Ownership helper for RLS
-- =============================================================
-- security definer so the customers policy can consult orders without the
-- two policies referencing each other.
create or replace function public.customer_visible_to_current_user(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders o
    where o.customer_id = p_customer_id
      and o.auth_user_id = auth.uid()
  );
$$;

grant execute on function public.customer_visible_to_current_user(uuid) to authenticated, service_role;

-- =============================================================
-- 5. place_order — the single authoritative order-creation entry point
-- =============================================================
-- The previous signature had no device id; drop it so the two do not overload.
drop function if exists public.place_order(uuid, text, text, uuid, uuid, text, text);

-- Records that a guest tried again, and what they tried to order, so staff can
-- see it without a second order ever existing.
create or replace function public.log_duplicate_attempt(
  p_auth_user_id  uuid,
  p_order         public.orders,
  p_phone         text,
  p_email         text,
  p_device_id     text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid,
  p_concurrent    boolean
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.admin_audit_logs (user_id, action, entity, entity_id, meta)
  values (
    p_auth_user_id, 'order.duplicate_attempt', 'orders', p_order.id::text,
    jsonb_build_object(
      'customer_id', p_order.customer_id,
      'phone', p_phone,
      'email', p_email,
      'device_id', p_device_id,
      'existing_order_number', p_order.order_number,
      'attempted_restaurant_id', p_restaurant_id,
      'attempted_menu_item_id', p_menu_item_id,
      'concurrent', p_concurrent
    )
  );
$$;

create or replace function public.place_order(
  p_auth_user_id  uuid,
  p_phone         text,
  p_event_slug    text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid,
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
  v_name       text := btrim(coalesce(p_name, ''));
  v_email      text := public.normalize_email(p_email);
  v_phone      text := public.normalize_saudi_phone(p_phone);
  v_device     text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  -- 0. an anonymous Supabase session is required so the guest can read their
  --    own order back afterwards. No code, no password, no registration.
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

  -- 4. THE duplicate rule: one order per event per phone OR per email.
  --    This pre-check exists to return the guest's existing order; the unique
  --    indexes below are what actually make it impossible to have two.
  select * into v_order
  from public.orders
  where event_id = v_event.id
    and (normalized_phone = v_phone or normalized_email = v_email)
  order by created_at
  limit 1;

  if found then
    perform public.log_duplicate_attempt(
      p_auth_user_id, v_order, v_phone, v_email, v_device, v_restaurant.id, v_item.id, false
    );
    return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
  end if;

  -- 5. customer directory row, matched on the phone identity key
  insert into public.customers (name, email, phone)
  values (v_name, v_email, v_phone)
  on conflict (phone) do update
    set name       = excluded.name,
        email      = excluded.email,
        updated_at = now()
  returning * into v_customer;

  -- 6. create the order using the authoritative database price
  begin
    insert into public.orders (
      order_number, event_id, customer_id, restaurant_id, menu_item_id,
      unit_price, item_name_en, item_name_ar, status,
      normalized_phone, normalized_email, auth_user_id, device_id
    ) values (
      public.next_order_number(v_event.order_prefix),
      v_event.id, v_customer.id, v_restaurant.id, v_item.id,
      v_item.price, v_item.name_en, v_item.name_ar, 'new',
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
        p_auth_user_id, v_order, v_phone, v_email, v_device, v_restaurant.id, v_item.id, true
      );
      return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
    end if;
    raise;
  end;

  return jsonb_build_object('result', 'created', 'order', public.order_payload(v_order.id));
end;
$$;

revoke all on function public.place_order(uuid, text, text, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, uuid, uuid, text, text, text)
  to service_role;

-- =============================================================
-- 6. RLS: ownership now runs through the order's anonymous auth user
-- =============================================================
-- A guest reads their own order either through the anonymous session that
-- placed it, or (for orders created before this migration) through the
-- customer row their auth user is still attached to.
drop policy if exists orders_self_read on public.orders;
create policy orders_self_read on public.orders
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or customer_id = public.current_customer_id()
    or public.is_admin()
  );

drop policy if exists order_status_history_read on public.order_status_history;
create policy order_status_history_read on public.order_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and (o.auth_user_id = auth.uid() or o.customer_id = public.current_customer_id())
    )
  );

-- A guest may read the customer row behind an order they own — their own
-- name, email and phone, and nobody else's.
drop policy if exists customers_self_read on public.customers;
create policy customers_self_read on public.customers
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.customer_visible_to_current_user(id)
    or public.is_admin()
  );
