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
-- 0004_storage.sql
-- ----------------------------------------------------------------
-- =============================================================
-- Image storage
--
-- One public bucket holds every image the storefront needs. Reads are public
-- because the storefront and next/image fetch them anonymously; every write is
-- restricted to accounts holding the `admin` role.
--
-- The bucket also enforces the size and MIME allow-list itself, so the limits
-- hold even if a caller bypasses the application's own checks.
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,                                             -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- policies ----------
-- Anyone may read: the storefront is public and unauthenticated.
drop policy if exists menu_images_public_read on storage.objects;
create policy menu_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'menu-images');

-- Only admins may add, replace or remove images.
drop policy if exists menu_images_admin_insert on storage.objects;
create policy menu_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists menu_images_admin_update on storage.objects;
create policy menu_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.is_admin())
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists menu_images_admin_delete on storage.objects;
create policy menu_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and public.is_admin());

-- ----------------------------------------------------------------
-- 0005_remove_phone_verification_add_event_identity.sql
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- 0006_order_items_one_per_category.sql
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- seed.sql
-- ----------------------------------------------------------------
-- =============================================================
-- Event seed data — KFC
-- Safe to re-run: everything is keyed on slugs.
-- =============================================================

insert into public.events (name_en, name_ar, slug, description_en, description_ar,
                           hero_image_url, order_prefix, start_date, end_date, status)
values (
  'LEAP Riyadh — Staff Dining',
  'ليب الرياض — مطاعم الفريق',
  'leap-riyadh',
  'Choose one dish from our partner kitchen. Verify your mobile number and collect your order at the venue.',
  'اختر طبقًا واحدًا من مطعمنا المشارك. وثّق رقم جوالك واستلم طلبك في الموقع.',
  '/menu/kfc-cover.jpg',
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

-- ---------- retire the previous demo restaurants ----------
-- Menu categories and items cascade. Orders use ON DELETE RESTRICT, so this
-- fails loudly rather than silently discarding a restaurant that has orders.
delete from public.restaurants
where slug in ('burger-house', 'italian-kitchen', 'saudi-bites', 'coffee-lab');

-- ---------- restaurant ----------
insert into public.restaurants (slug, name_en, name_ar, description_en, description_ar,
                                cuisine_en, cuisine_ar, cover_image_url, logo_url,
                                display_order, status)
values
  ('kfc', 'KFC', 'كنتاكي',
   'World famous Original Recipe fried chicken, Zinger burgers, Twisters and crispy strips.',
   'دجاج مقلي بالوصفة الأصلية الشهيرة، وبرجر الزنجر، والتويستر، والستربس المقرمشة.',
   'Fast Food / Fried Chicken', 'وجبات سريعة / دجاج مقلي',
   '/menu/kfc-cover.jpg',
   '/menu/kfc-logo.jpg',
   1, 'active')
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  cuisine_en = excluded.cuisine_en, cuisine_ar = excluded.cuisine_ar,
  cover_image_url = excluded.cover_image_url, logo_url = excluded.logo_url,
  display_order = excluded.display_order, status = excluded.status;

-- link KFC to the event
insert into public.event_restaurants (event_id, restaurant_id, display_order)
select e.id, r.id, r.display_order
from public.events e
cross join public.restaurants r
where e.slug = 'leap-riyadh' and r.slug = 'kfc'
on conflict (event_id, restaurant_id) do nothing;

-- ---------- categories ----------
with data (restaurant_slug, name_en, name_ar, display_order) as (values
  ('kfc', 'Combos & Meals',  'الوجبات',              1),
  ('kfc', 'Dips',            'الصلصات',              2),
  ('kfc', 'Sides & Drinks',  'الإضافات والمشروبات',  3)
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
  -- Combos & Meals
  ('kfc', 'Combos & Meals', 'Twister Combo', 'وجبة تويستر',
   'Crispy chicken twister wrap with fries and a drink.',
   'راب تويستر بالدجاج المقرمش مع بطاطس ومشروب.', 40.00,
   '/menu/twister-combo.jpg', true, 1),
  ('kfc', 'Combos & Meals', 'Zinger Combo', 'وجبة زنجر',
   'Spicy Zinger chicken fillet burger with fries and a drink.',
   'برجر فيليه دجاج زنجر الحار مع بطاطس ومشروب.', 45.00,
   '/menu/zinger-combo.jpg', true, 2),
  ('kfc', 'Combos & Meals', 'Mighty Zinger Combo', 'وجبة ميتي زنجر',
   'Double Zinger fillets with cheese, served with fries and a drink.',
   'قطعتا فيليه زنجر مع الجبن، تقدم مع بطاطس ومشروب.', 50.00,
   '/menu/mighty-zinger-combo.jpg', true, 3),
  ('kfc', 'Combos & Meals', 'Dinner Meal', 'وجبة الدينر',
   'Original Recipe chicken pieces with fries and a drink.',
   'قطع دجاج بالوصفة الأصلية مع بطاطس ومشروب.', 55.00,
   '/menu/dinner-meal.jpg', true, 4),
  ('kfc', 'Combos & Meals', 'Crispy Strips Meal', 'وجبة ستربس',
   'Crispy chicken strips with fries and a drink.',
   'ستربس دجاج مقرمشة مع بطاطس ومشروب.', 50.00,
   '/menu/crispy-strips-meal.jpg', true, 5),

  -- Dips
  ('kfc', 'Dips', 'BBQ', 'باربكيو',
   'Smoky barbecue dipping sauce.',
   'صلصة الباربكيو المدخنة.', 5.00,
   '/menu/bbq-dip.jpg', true, 1),
  ('kfc', 'Dips', 'Spicy Ranch', 'رانش حار',
   'Creamy ranch with a chilli kick.',
   'صلصة رانش كريمية بلمسة حارة.', 5.00,
   '/menu/spicy-ranch-dip.jpg', true, 2),
  ('kfc', 'Dips', 'Garlic Buttermilk Mayonnaise', 'مايونيز الثوم بالزبدة',
   'Creamy garlic and buttermilk mayonnaise.',
   'مايونيز كريمي بالثوم واللبن.', 5.00,
   '/menu/garlic-mayo-dip.jpg', true, 3),
  ('kfc', 'Dips', 'Dynamite', 'دايناميت',
   'Sweet and spicy dynamite sauce.',
   'صلصة دايناميت حلوة وحارة.', 5.00,
   '/menu/dynamite-dip.jpg', true, 4),
  ('kfc', 'Dips', 'Ranch', 'رانش',
   'Classic creamy ranch dip.',
   'صلصة رانش كريمية كلاسيكية.', 5.00,
   '/menu/ranch-dip.jpg', true, 5),

  -- Sides & Drinks
  ('kfc', 'Sides & Drinks', 'Fries (Medium)', 'بطاطس (وسط)',
   'Medium portion of golden fries.',
   'حصة وسط من البطاطس الذهبية.', 15.00,
   '/menu/fries-medium.jpg', true, 1),
  ('kfc', 'Sides & Drinks', 'Soft Drinks 330ml', 'مشروب غازي 330 مل',
   'Chilled soft drink can, 330ml.',
   'علبة مشروب غازي مثلجة، 330 مل.', 10.00,
   '/menu/soft-drink-330ml.jpg', true, 2),
  ('kfc', 'Sides & Drinks', 'Orange Juice', 'عصير برتقال',
   'Chilled orange juice.',
   'عصير برتقال مثلج.', 20.00,
   '/menu/orange-juice.jpg', true, 3),
  ('kfc', 'Sides & Drinks', 'Spicy Powder', 'بودرة حارة',
   'Spicy seasoning powder for your fries.',
   'بودرة توابل حارة لبطاطسك.', 3.00,
   '/menu/spicy-powder.jpg', true, 4),
  ('kfc', 'Sides & Drinks', 'Water 500ml', 'مياه 500 مل',
   'Bottled drinking water, 500ml.',
   'مياه شرب معبأة، 500 مل.', 8.00,
   '/menu/water-500ml.jpg', true, 5)
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
