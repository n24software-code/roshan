-- =============================================================
-- GENERATED FILE — do not edit.
-- Produced by: node scripts/bundle-sql.mjs
-- Paste this whole file into the Supabase SQL Editor and run it.
-- =============================================================

-- ----------------------------------------------------------------
-- 0001_init.sql
-- ----------------------------------------------------------------
-- =============================================================
-- Event Restaurant Ordering Platform — core schema
-- Event -> Restaurants -> Categories -> Menu Items -> Orders -> Customers
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type public.event_status as enum ('draft', 'active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.restaurant_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum
    ('new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_role as enum ('admin');
exception when duplicate_object then null; end $$;

-- ---------- shared updated_at trigger ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- events ----------
create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  name_en        text not null check (length(btrim(name_en)) > 0),
  name_ar        text not null check (length(btrim(name_ar)) > 0),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description_en text,
  description_ar text,
  logo_url       text,
  hero_image_url text,
  order_prefix   text not null default 'A' check (order_prefix ~ '^[A-Z]{1,4}$'),
  start_date     timestamptz,
  end_date       timestamptz,
  status         public.event_status not null default 'draft',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint events_date_range check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists events_status_idx on public.events (status);

-- ---------- restaurants ----------
create table if not exists public.restaurants (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null check (length(btrim(name_en)) > 0),
  name_ar         text not null check (length(btrim(name_ar)) > 0),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description_en  text,
  description_ar  text,
  cuisine_en      text,
  cuisine_ar      text,
  logo_url        text,
  cover_image_url text,
  display_order   integer not null default 0,
  status          public.restaurant_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists restaurants_status_idx on public.restaurants (status);

-- ---------- event <-> restaurant ----------
create table if not exists public.event_restaurants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (event_id, restaurant_id)
);
create index if not exists event_restaurants_event_idx on public.event_restaurants (event_id);

-- ---------- menu categories ----------
create table if not exists public.menu_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name_en       text not null check (length(btrim(name_en)) > 0),
  name_ar       text not null check (length(btrim(name_ar)) > 0),
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists menu_categories_restaurant_idx on public.menu_categories (restaurant_id);

-- ---------- menu items ----------
create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  category_id    uuid references public.menu_categories (id) on delete set null,
  name_en        text not null check (length(btrim(name_en)) > 0),
  name_ar        text not null check (length(btrim(name_ar)) > 0),
  description_en text,
  description_ar text,
  price          numeric(10, 2) not null check (price >= 0),
  image_url      text,
  is_available   boolean not null default true,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id);
create index if not exists menu_items_category_idx on public.menu_items (category_id);

-- A menu item's category must belong to the same restaurant as the item.
create or replace function public.enforce_category_restaurant()
returns trigger
language plpgsql
as $$
declare
  v_restaurant uuid;
begin
  if new.category_id is null then
    return new;
  end if;
  select restaurant_id into v_restaurant from public.menu_categories where id = new.category_id;
  if v_restaurant is null or v_restaurant <> new.restaurant_id then
    raise exception 'menu category % does not belong to restaurant %', new.category_id, new.restaurant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists menu_items_category_guard on public.menu_items;
create trigger menu_items_category_guard
  before insert or update of category_id, restaurant_id on public.menu_items
  for each row execute function public.enforce_category_restaurant();

-- ---------- customers ----------
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  name           text not null check (length(btrim(name)) between 2 and 120),
  email          text not null check (email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  phone          text not null unique check (phone ~ '^\+9665[0-9]{8}$'),
  phone_verified boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists customers_email_idx on public.customers (lower(email));

-- ---------- order numbers ----------
create sequence if not exists public.order_number_seq start with 1001 increment by 1;

-- ---------- orders ----------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null unique,
  event_id      uuid not null references public.events (id) on delete restrict,
  customer_id   uuid not null references public.customers (id) on delete restrict,
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  menu_item_id  uuid not null references public.menu_items (id) on delete restrict,
  -- price + names snapshotted from the database at creation time (never from the client)
  unit_price    numeric(10, 2) not null check (unit_price >= 0),
  item_name_en  text not null,
  item_name_ar  text not null,
  status        public.order_status not null default 'new',
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- THE core business rule: one order per customer per event
  constraint orders_one_per_customer_per_event unique (event_id, customer_id)
);
create index if not exists orders_event_idx on public.orders (event_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_restaurant_idx on public.orders (restaurant_id);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_created_idx on public.orders (created_at desc);

-- ---------- order status history ----------
create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid references auth.users (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  type       text not null,
  title      text not null,
  body       text,
  order_id   uuid references public.orders (id) on delete cascade,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_unread_idx on public.notifications (is_read, created_at desc);

-- ---------- roles ----------
create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- ---------- audit log ----------
create table if not exists public.admin_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

-- ---------- app settings ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'events','restaurants','menu_categories','menu_items','customers','orders','app_settings'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 0002_functions.sql
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- 0003_rls.sql
-- ----------------------------------------------------------------
-- =============================================================
-- Row Level Security
-- Principle: the public catalogue is readable by everyone; everything
-- that identifies a person is readable only by its owner or an admin;
-- every write that matters happens server-side via service_role.
-- =============================================================

alter table public.events              enable row level security;
alter table public.restaurants         enable row level security;
alter table public.event_restaurants   enable row level security;
alter table public.menu_categories     enable row level security;
alter table public.menu_items          enable row level security;
alter table public.customers           enable row level security;
alter table public.orders              enable row level security;
alter table public.order_status_history enable row level security;
alter table public.notifications       enable row level security;
alter table public.user_roles          enable row level security;
alter table public.admin_audit_logs    enable row level security;
alter table public.app_settings        enable row level security;

-- ---------- public catalogue: read-only for everyone ----------
-- Disabled restaurants and unavailable items stay readable so the storefront
-- can render "Currently unavailable"; ordering is blocked server-side.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select to anon, authenticated using (status = 'active' or public.is_admin());

drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants
  for select to anon, authenticated using (true);

drop policy if exists event_restaurants_public_read on public.event_restaurants;
create policy event_restaurants_public_read on public.event_restaurants
  for select to anon, authenticated using (true);

drop policy if exists menu_categories_public_read on public.menu_categories;
create policy menu_categories_public_read on public.menu_categories
  for select to anon, authenticated using (true);

drop policy if exists menu_items_public_read on public.menu_items;
create policy menu_items_public_read on public.menu_items
  for select to anon, authenticated using (true);

-- ---------- admin write access on the catalogue ----------
do $$
declare t text;
begin
  foreach t in array array[
    'events','restaurants','event_restaurants','menu_categories','menu_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- ---------- customers ----------
-- A verified customer sees only their own row. Admins see all.
drop policy if exists customers_self_read on public.customers;
create policy customers_self_read on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists customers_admin_write on public.customers;
create policy customers_admin_write on public.customers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- orders ----------
-- Customers may read their own order. They may never insert or update:
-- creation goes through place_order(), status changes through the admin.
drop policy if exists orders_self_read on public.orders;
create policy orders_self_read on public.orders
  for select to authenticated
  using (customer_id = public.current_customer_id() or public.is_admin());

drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_admin_insert on public.orders;
create policy orders_admin_insert on public.orders
  for insert to authenticated with check (public.is_admin());

-- ---------- order status history ----------
drop policy if exists order_status_history_read on public.order_status_history;
create policy order_status_history_read on public.order_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and o.customer_id = public.current_customer_id()
    )
  );

-- ---------- admin-only tables ----------
do $$
declare t text;
begin
  foreach t in array array[
    'notifications','admin_audit_logs','app_settings'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- ---------- user roles ----------
-- Readable by the owner (so the app can check its own role) and by admins.
-- Never writable from a browser session: roles are granted server-side.
drop policy if exists user_roles_self_read on public.user_roles;
create policy user_roles_self_read on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------
-- seed.sql
-- ----------------------------------------------------------------
-- =============================================================
-- Development seed data
-- Safe to re-run: everything is keyed on slugs.
-- =============================================================

insert into public.events (name_en, name_ar, slug, description_en, description_ar,
                           hero_image_url, order_prefix, start_date, end_date, status)
values (
  'LEAP Riyadh — Staff Dining',
  'ليب الرياض — مطاعم الفريق',
  'leap-riyadh',
  'Choose one dish from one of our partner kitchens. Verify your mobile number and collect your order at the venue.',
  'اختر طبقًا واحدًا من أحد مطاعمنا المشاركة. وثّق رقم جوالك واستلم طلبك في الموقع.',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=2000&q=80',
  'A',
  now() - interval '1 day',
  now() + interval '30 days',
  'active'
)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  hero_image_url = excluded.hero_image_url,
  start_date = excluded.start_date, end_date = excluded.end_date,
  status = excluded.status;

insert into public.restaurants (slug, name_en, name_ar, description_en, description_ar,
                                cuisine_en, cuisine_ar, cover_image_url, logo_url,
                                display_order, status)
values
  ('burger-house', 'Burger House', 'برجر هاوس',
   'Flame-grilled patties, brioche buns and hand-cut sides.',
   'لحوم مشوية على اللهب، خبز بريوش ومقبلات طازجة.',
   'Burgers', 'برجر',
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=300&q=80',
   1, 'active'),
  ('italian-kitchen', 'Italian Kitchen', 'المطبخ الإيطالي',
   'Slow-proved dough, fresh pasta and Mediterranean classics.',
   'عجينة مخمرة ببطء، معكرونة طازجة وأطباق متوسطية.',
   'Italian', 'إيطالي',
   'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1595295333158-4742f28fbd85?auto=format&fit=crop&w=300&q=80',
   2, 'active'),
  ('saudi-bites', 'Saudi Bites', 'لقمة سعودية',
   'Home-style Saudi cooking, from kabsa to kunafa.',
   'أطباق سعودية بيتية، من الكبسة إلى الكنافة.',
   'Saudi', 'سعودي',
   'https://images.unsplash.com/photo-1547496502-affa22d38842?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1541518763669-27fef04b14ea?auto=format&fit=crop&w=300&q=80',
   3, 'active'),
  ('coffee-lab', 'Coffee Lab', 'مختبر القهوة',
   'Single-origin coffee, Saudi qahwa and fresh bakes.',
   'قهوة مختصة، قهوة سعودية ومخبوزات طازجة.',
   'Coffee & Bakery', 'قهوة ومخبوزات',
   'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=300&q=80',
   4, 'disabled')
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  cuisine_en = excluded.cuisine_en, cuisine_ar = excluded.cuisine_ar,
  cover_image_url = excluded.cover_image_url, logo_url = excluded.logo_url,
  display_order = excluded.display_order;

-- link every seeded restaurant to the event
insert into public.event_restaurants (event_id, restaurant_id, display_order)
select e.id, r.id, r.display_order
from public.events e
cross join public.restaurants r
where e.slug = 'leap-riyadh'
  and r.slug in ('burger-house', 'italian-kitchen', 'saudi-bites', 'coffee-lab')
on conflict (event_id, restaurant_id) do nothing;

-- ---------- categories ----------
with data (restaurant_slug, name_en, name_ar, display_order) as (values
  ('burger-house',    'Burgers',      'برجر',        1),
  ('burger-house',    'Sides',        'مقبلات',      2),
  ('burger-house',    'Drinks',       'مشروبات',     3),
  ('italian-kitchen', 'Pizza',        'بيتزا',       1),
  ('italian-kitchen', 'Pasta',        'باستا',       2),
  ('italian-kitchen', 'Desserts',     'حلويات',      3),
  ('saudi-bites',     'Main Course',  'الأطباق الرئيسية', 1),
  ('saudi-bites',     'Sides',        'مقبلات',      2),
  ('saudi-bites',     'Desserts',     'حلويات',      3),
  ('coffee-lab',      'Coffee',       'قهوة',        1),
  ('coffee-lab',      'Bakery',       'مخبوزات',     2)
)
insert into public.menu_categories (restaurant_id, name_en, name_ar, display_order)
select r.id, d.name_en, d.name_ar, d.display_order
from data d join public.restaurants r on r.slug = d.restaurant_slug
where not exists (
  select 1 from public.menu_categories c
  where c.restaurant_id = r.id and c.name_en = d.name_en
);

-- ---------- menu items ----------
with data (restaurant_slug, category_en, name_en, name_ar, description_en, description_ar,
           price, image_url, is_available, display_order) as (values
  ('burger-house', 'Burgers', 'Classic Beef Burger', 'برجر لحم كلاسيكي',
   'Grilled beef patty, aged cheddar, lettuce, tomato and house sauce.',
   'قطعة لحم مشوية مع جبن شيدر، خس، طماطم وصلصة البيت.', 32.00,
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', true, 1),
  ('burger-house', 'Burgers', 'Crispy Chicken Burger', 'برجر دجاج مقرمش',
   'Buttermilk chicken, pickles and garlic mayo.',
   'دجاج مقرمش مع مخلل ومايونيز الثوم.', 30.00,
   'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=80', true, 2),
  ('burger-house', 'Burgers', 'Double Cheese Burger', 'برجر جبن مزدوج',
   'Two beef patties with double cheddar.',
   'قطعتا لحم مع جبن شيدر مضاعف.', 38.00,
   'https://images.unsplash.com/photo-1553979459-d2229ba7433a?auto=format&fit=crop&w=800&q=80', true, 3),
  ('burger-house', 'Sides', 'Truffle Fries', 'بطاطس بالكمأة',
   'Hand-cut fries, truffle oil and parmesan.',
   'بطاطس مقطعة يدويًا مع زيت الكمأة والبارميزان.', 22.00,
   'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=800&q=80', true, 1),
  ('burger-house', 'Drinks', 'Fresh Lemon Mint', 'ليمون بالنعناع',
   'Blended lemon and mint over ice.',
   'ليمون مع النعناع مثلج.', 18.00,
   'https://images.unsplash.com/photo-1523371683702-af9ba4a3e0d6?auto=format&fit=crop&w=800&q=80', true, 1),

  ('italian-kitchen', 'Pizza', 'Margherita', 'مارغريتا',
   'San Marzano tomato, fior di latte and basil.',
   'طماطم سان مارزانو مع جبن الموزاريلا والريحان.', 42.00,
   'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=80', true, 1),
  ('italian-kitchen', 'Pizza', 'Truffle Mushroom Pizza', 'بيتزا الفطر والكمأة',
   'Wild mushrooms, mozzarella and truffle cream.',
   'فطر بري مع موزاريلا وكريمة الكمأة.', 52.00,
   'https://images.unsplash.com/photo-1595854341625-f33ee10dbf94?auto=format&fit=crop&w=800&q=80', true, 2),
  ('italian-kitchen', 'Pasta', 'Penne Arrabbiata', 'بيني أرابياتا',
   'Chilli, garlic and slow-cooked tomato.',
   'فلفل حار وثوم وصلصة طماطم مطهوة ببطء.', 40.00,
   'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=800&q=80', true, 1),
  ('italian-kitchen', 'Pasta', 'Chicken Alfredo', 'ألفريدو بالدجاج',
   'Fettuccine in parmesan cream with grilled chicken.',
   'فيتوتشيني بكريمة البارميزان مع دجاج مشوي.', 46.00,
   'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?auto=format&fit=crop&w=800&q=80', true, 2),
  ('italian-kitchen', 'Desserts', 'Tiramisu', 'تيراميسو',
   'Mascarpone, espresso and cocoa.',
   'ماسكاربوني وإسبريسو وكاكاو.', 26.00,
   'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80', false, 1),

  ('saudi-bites', 'Main Course', 'Chicken Kabsa', 'كبسة دجاج',
   'Spiced rice with slow-roasted chicken and daqqous.',
   'أرز بالبهارات مع دجاج مشوي ببطء ودقوس.', 45.00,
   'https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=800&q=80', true, 1),
  ('saudi-bites', 'Main Course', 'Lamb Mandi', 'مندي لحم',
   'Smoked lamb over aromatic rice.',
   'لحم مدخن على أرز معطر.', 65.00,
   'https://images.unsplash.com/photo-1633945274801-193d6d95c1a0?auto=format&fit=crop&w=800&q=80', true, 2),
  ('saudi-bites', 'Main Course', 'Jareesh', 'جريش',
   'Crushed wheat slow-cooked with yoghurt and onion.',
   'قمح مجروش مطهو ببطء مع اللبن والبصل.', 35.00,
   'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', true, 3),
  ('saudi-bites', 'Sides', 'Tabbouleh', 'تبولة',
   'Parsley, tomato, bulgur and lemon.',
   'بقدونس وطماطم وبرغل وليمون.', 20.00,
   'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80', true, 1),
  ('saudi-bites', 'Desserts', 'Kunafa', 'كنافة',
   'Warm cheese kunafa with rose syrup.',
   'كنافة بالجبن مع شراب الورد.', 28.00,
   'https://images.unsplash.com/photo-1583350632342-b6e8d5f4b3b4?auto=format&fit=crop&w=800&q=80', true, 1),

  ('coffee-lab', 'Coffee', 'Saudi Qahwa', 'قهوة سعودية',
   'Cardamom and saffron coffee served with dates.',
   'قهوة بالهيل والزعفران تقدم مع التمر.', 16.00,
   'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80', true, 1),
  ('coffee-lab', 'Coffee', 'Flat White', 'فلات وايت',
   'Double ristretto with silky milk.',
   'ريستريتو مزدوج مع حليب مخملي.', 20.00,
   'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80', true, 2),
  ('coffee-lab', 'Bakery', 'Butter Croissant', 'كرواسون بالزبدة',
   'Laminated all-butter croissant.',
   'كرواسون بالزبدة الفرنسية.', 15.00,
   'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80', true, 1)
)
insert into public.menu_items (restaurant_id, category_id, name_en, name_ar,
                               description_en, description_ar, price, image_url,
                               is_available, display_order)
select r.id, c.id, d.name_en, d.name_ar, d.description_en, d.description_ar,
       d.price, d.image_url, d.is_available, d.display_order
from data d
join public.restaurants r on r.slug = d.restaurant_slug
join public.menu_categories c on c.restaurant_id = r.id and c.name_en = d.category_en
where not exists (
  select 1 from public.menu_items m where m.restaurant_id = r.id and m.name_en = d.name_en
);

insert into public.app_settings (key, value)
values ('general', jsonb_build_object('active_event_slug', 'leap-riyadh', 'sound_notifications', true))
on conflict (key) do nothing;
