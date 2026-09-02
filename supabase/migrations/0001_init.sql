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
