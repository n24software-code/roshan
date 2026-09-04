-- =============================================================
-- WhatsApp phone verification + one verified phone = one order
--
-- Adds:
--   * public.phone_verifications          — verification requests and sessions
--   * public.orders.customer_phone        — the normalized phone on the order
--   * UNIQUE (event_id, customer_phone)   — the hard duplicate-order guarantee
--   * verification + order RPCs, callable only by service_role
--
-- Nothing here changes the restaurant, seat, menu or status-transition logic.
-- =============================================================

-- ---------- enum ----------
do $$ begin
  create type public.verification_status as enum ('pending', 'verified', 'expired', 'failed');
exception when duplicate_object then null; end $$;

-- =============================================================
-- 1. Verification requests
--
-- One row per "I want to verify this number for this event" request.
--   code_hash          HMAC of the one-time code. The raw code is never stored,
--                      and it is cleared the moment the number is verified, so a
--                      code can never be replayed.
--   session_token_hash SHA-256 of the opaque token handed to the browser in an
--                      httpOnly cookie. The cookie is a lookup key only: status,
--                      event and expiry are always read from this row.
-- =============================================================
create table if not exists public.phone_verifications (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  phone               text not null check (phone ~ '^\+9665[0-9]{8}$'),
  name                text not null check (length(btrim(name)) between 2 and 120),
  code_hash           text,
  session_token_hash  text not null unique,
  status              public.verification_status not null default 'pending',
  attempts            integer not null default 0 check (attempts >= 0),
  channel             text not null default 'whatsapp',
  provider            text not null default 'unknown',
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  verified_at         timestamptz,
  session_expires_at  timestamptz
);

create index if not exists phone_verifications_event_phone_idx
  on public.phone_verifications (event_id, phone, status);
create index if not exists phone_verifications_phone_pending_idx
  on public.phone_verifications (phone, status, expires_at desc);
create index if not exists phone_verifications_created_idx
  on public.phone_verifications (created_at desc);

-- =============================================================
-- 2. The normalized phone number on the order itself
--
-- The order already pointed at a customer whose phone is unique, but the
-- business rule is about the *phone*, so the phone is stored on the order and
-- the uniqueness is enforced there. The column is filled by a trigger, never by
-- a caller, so every insertion path — RPC, admin, psql — is covered.
-- =============================================================
alter table public.orders add column if not exists customer_phone text;

update public.orders o
set customer_phone = c.phone
from public.customers c
where c.id = o.customer_id and o.customer_phone is null;

create or replace function public.set_order_customer_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select phone into new.customer_phone from public.customers where id = new.customer_id;
  if new.customer_phone is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_customer_phone on public.orders;
create trigger orders_set_customer_phone
  before insert or update of customer_id on public.orders
  for each row execute function public.set_order_customer_phone();

-- Keep the denormalized copy honest if a customer's number is ever corrected.
create or replace function public.sync_orders_customer_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.phone is distinct from old.phone then
    update public.orders set customer_phone = new.phone where customer_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_sync_order_phone on public.customers;
create trigger customers_sync_order_phone
  after update of phone on public.customers
  for each row execute function public.sync_orders_customer_phone();

alter table public.orders alter column customer_phone set not null;

do $$ begin
  alter table public.orders
    add constraint orders_one_per_phone_per_event unique (event_id, customer_phone);
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists orders_customer_phone_idx on public.orders (customer_phone);

-- =============================================================
-- 3. Email is no longer required
--
-- Attendees identify themselves with a name and a phone number only. Existing
-- addresses are kept, and anything that is supplied is still validated.
-- =============================================================
alter table public.customers alter column email drop not null;
alter table public.customers drop constraint if exists customers_email_check;
alter table public.customers
  add constraint customers_email_check
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$');

-- =============================================================
-- 4. Shared order helpers
--
-- Extracted from place_order so that both the legacy entry point and the new
-- verified entry point validate and insert through exactly the same code.
-- =============================================================
create or replace function public.resolve_order_target(
  p_event_slug    text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid
)
returns table (
  event_id     uuid,
  order_prefix text,
  restaurant_id uuid,
  menu_item_id uuid,
  unit_price   numeric,
  item_name_en text,
  item_name_ar text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event      public.events%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_item       public.menu_items%rowtype;
begin
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
    where event_restaurants.event_id = v_event.id
      and event_restaurants.restaurant_id = v_restaurant.id
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

  return query select
    v_event.id, v_event.order_prefix, v_restaurant.id, v_item.id,
    v_item.price, v_item.name_en, v_item.name_ar;
end;
$$;

/**
 * Creates the order, or reports the existing one. The UNIQUE constraint on
 * (event_id, customer_phone) is what actually decides the race — the SELECT
 * below is only a fast path for the common, uncontended case.
 */
create or replace function public.create_order_core(
  p_customer_id   uuid,
  p_phone         text,
  p_event_id      uuid,
  p_order_prefix  text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid,
  p_unit_price    numeric,
  p_item_name_en  text,
  p_item_name_ar  text,
  p_actor         uuid default null,
  p_meta          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where orders.event_id = p_event_id and orders.customer_phone = p_phone;

  if found then
    insert into public.admin_audit_logs (user_id, action, entity, entity_id, meta)
    values (
      p_actor, 'order.duplicate_attempt', 'orders', v_order.id::text,
      p_meta || jsonb_build_object(
        'customer_id', p_customer_id,
        'phone', p_phone,
        'existing_order_number', v_order.order_number,
        'attempted_restaurant_id', p_restaurant_id,
        'attempted_menu_item_id', p_menu_item_id,
        'attempted_item_name', p_item_name_en
      )
    );
    return jsonb_build_object('result', 'duplicate', 'order', public.order_payload(v_order.id));
  end if;

  begin
    insert into public.orders (
      order_number, event_id, customer_id, restaurant_id, menu_item_id,
      unit_price, item_name_en, item_name_ar, status
    ) values (
      public.next_order_number(p_order_prefix),
      p_event_id, p_customer_id, p_restaurant_id, p_menu_item_id,
      p_unit_price, p_item_name_en, p_item_name_ar, 'new'
    )
    returning * into v_order;
  exception when unique_violation then
    -- Lost a race against a concurrent submission: return the winner.
    select * into v_order
    from public.orders
    where orders.event_id = p_event_id and orders.customer_phone = p_phone;

    if found then
      insert into public.admin_audit_logs (user_id, action, entity, entity_id, meta)
      values (
        p_actor, 'order.duplicate_attempt', 'orders', v_order.id::text,
        p_meta || jsonb_build_object(
          'customer_id', p_customer_id,
          'phone', p_phone,
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

-- The confirmation screen no longer reads the order through RLS with a Supabase
-- session, so the cancellation reason has to travel in the payload.
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
    'cancel_reason', o.cancel_reason,
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

-- =============================================================
-- 5. place_order — unchanged contract, now built on the shared helpers.
--    Email became optional; anything supplied is still validated.
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
  v_target   record;
  v_customer public.customers%rowtype;
  v_name     text := btrim(coalesce(p_name, ''));
  v_email    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone    text := btrim(coalesce(p_phone, ''));
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

  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.resolve_order_target(p_event_slug, p_restaurant_id, p_menu_item_id);

  insert into public.customers (auth_user_id, name, email, phone, phone_verified)
  values (p_auth_user_id, v_name, v_email, v_phone, true)
  on conflict (phone) do update
    set auth_user_id   = coalesce(public.customers.auth_user_id, excluded.auth_user_id),
        name           = excluded.name,
        email          = coalesce(excluded.email, public.customers.email),
        phone_verified = true,
        updated_at     = now()
  returning * into v_customer;

  return public.create_order_core(
    v_customer.id, v_phone, v_target.event_id, v_target.order_prefix,
    v_target.restaurant_id, v_target.menu_item_id, v_target.unit_price,
    v_target.item_name_en, v_target.item_name_ar, p_auth_user_id
  );
end;
$$;

-- =============================================================
-- 6. Verification RPCs
-- =============================================================

/** Moves every timed-out pending request to 'expired'. Called before each read. */
create or replace function public.expire_stale_verifications()
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.phone_verifications
  set status = 'expired'
  where status = 'pending' and expires_at <= now();
$$;

/**
 * Creates a verification request.
 *
 * The caller (the Next.js server) generates the one-time code and the session
 * token and passes only their hashes, so neither secret is ever written to the
 * database or the logs.
 */
create or replace function public.request_phone_verification(
  p_event_slug         text,
  p_phone              text,
  p_name               text,
  p_code_hash          text,
  p_token_hash         text,
  p_code_ttl_seconds   integer default 600,
  p_provider           text default 'unknown',
  p_resend_cooldown_seconds integer default 30,
  p_max_per_hour       integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.events%rowtype;
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_row   public.phone_verifications%rowtype;
  v_recent integer;
  v_last  timestamptz;
begin
  if v_phone !~ '^\+9665[0-9]{8}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_code_hash), '') = '' or coalesce(btrim(p_token_hash), '') = '' then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select * into v_event from public.events where slug = p_event_slug;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_event.status <> 'active'
     or (v_event.start_date is not null and now() < v_event.start_date)
     or (v_event.end_date is not null and now() > v_event.end_date) then
    raise exception 'EVENT_INACTIVE' using errcode = 'P0001';
  end if;

  perform public.expire_stale_verifications();

  -- A number that has already ordered may still verify again — that is how a
  -- guest who cleared their cookies recovers their order number. Nothing about
  -- the existing order is revealed here: it is only returned once ownership of
  -- the number has actually been proven.
  --
  -- Rate limiting: a cooldown between requests, and a ceiling per hour.
  select max(created_at) into v_last
  from public.phone_verifications
  where phone = v_phone;

  if v_last is not null
     and v_last > now() - (p_resend_cooldown_seconds || ' seconds')::interval then
    raise exception 'RESEND_TOO_SOON' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
  from public.phone_verifications
  where phone = v_phone and created_at > now() - interval '1 hour';

  if v_recent >= p_max_per_hour then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  -- A new request supersedes any earlier pending one for the same event.
  update public.phone_verifications
  set status = 'expired'
  where phone = v_phone and event_id = v_event.id and status = 'pending';

  insert into public.phone_verifications (
    event_id, phone, name, code_hash, session_token_hash, provider, expires_at
  ) values (
    v_event.id, v_phone, v_name, p_code_hash, p_token_hash, coalesce(p_provider, 'unknown'),
    now() + (p_code_ttl_seconds || ' seconds')::interval
  )
  returning * into v_row;

  return jsonb_build_object(
    'result', 'created',
    'verification_id', v_row.id,
    'phone', v_row.phone,
    'name', v_row.name,
    'expires_at', v_row.expires_at,
    'event', jsonb_build_object('id', v_event.id, 'slug', v_event.slug)
  );
end;
$$;

/**
 * Consumes an inbound WhatsApp message.
 *
 * The sender's number and the code must both match a live pending request. On
 * success the code hash is destroyed, so the same message can never verify a
 * second time. A mismatch burns an attempt for that number.
 */
create or replace function public.confirm_phone_verification(
  p_phone                  text,
  p_code_hash              text,
  p_provider               text default null,
  p_max_attempts           integer default 5,
  p_session_ttl_seconds    integer default 21600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.phone_verifications%rowtype;
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  if v_phone !~ '^\+9665[0-9]{8}$' then
    return jsonb_build_object('result', 'no_match', 'reason', 'invalid_phone');
  end if;
  if coalesce(btrim(p_code_hash), '') = '' then
    return jsonb_build_object('result', 'no_match', 'reason', 'no_code');
  end if;

  perform public.expire_stale_verifications();

  select * into v_row
  from public.phone_verifications
  where phone = v_phone
    and status = 'pending'
    and code_hash = p_code_hash
    and expires_at > now()
    and attempts < p_max_attempts
  order by created_at desc
  limit 1
  for update;

  if not found then
    -- Burn an attempt on every live request for this number, and retire the
    -- ones that have run out.
    update public.phone_verifications
    set attempts = attempts + 1
    where phone = v_phone and status = 'pending' and expires_at > now();

    update public.phone_verifications
    set status = 'failed'
    where phone = v_phone and status = 'pending' and attempts >= p_max_attempts;

    return jsonb_build_object('result', 'no_match');
  end if;

  update public.phone_verifications
  set status             = 'verified',
      verified_at        = now(),
      code_hash          = null,
      provider           = coalesce(p_provider, provider),
      session_expires_at = now() + (p_session_ttl_seconds || ' seconds')::interval
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'result', 'verified',
    'verification_id', v_row.id,
    'phone', v_row.phone,
    'event_id', v_row.event_id,
    'verified_at', v_row.verified_at
  );
end;
$$;

/**
 * The authoritative state behind a browser's verification cookie.
 * The cookie is only a lookup key — everything returned here comes from the row.
 */
create or replace function public.verification_session(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.phone_verifications%rowtype;
  v_event  public.events%rowtype;
  v_order  public.orders%rowtype;
  v_status text;
begin
  if coalesce(btrim(p_token_hash), '') = '' then
    return jsonb_build_object('status', 'none');
  end if;

  select * into v_row
  from public.phone_verifications
  where session_token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  select * into v_event from public.events where id = v_row.event_id;

  v_status := v_row.status::text;
  if v_status = 'pending' and v_row.expires_at <= now() then
    v_status := 'expired';
  end if;
  if v_status = 'verified'
     and v_row.session_expires_at is not null
     and v_row.session_expires_at <= now() then
    v_status := 'expired';
  end if;

  -- Only a session that has actually been verified may see the order. A pending
  -- request proves nothing, so typing someone else's number reveals nothing.
  if v_status = 'verified' then
    select * into v_order
    from public.orders
    where orders.event_id = v_row.event_id and orders.customer_phone = v_row.phone;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'verification_id', v_row.id,
    'phone', v_row.phone,
    'name', v_row.name,
    'attempts', v_row.attempts,
    'expires_at', v_row.expires_at,
    'session_expires_at', v_row.session_expires_at,
    'event', case when v_event.id is null then null else
      jsonb_build_object('id', v_event.id, 'slug', v_event.slug) end,
    'order', case when v_order.id is null then null else public.order_payload(v_order.id) end
  );
end;
$$;

/**
 * The one order-creation entry point for verified attendees.
 *
 * Identity comes from the verification row, never from the request body, and
 * the row's event must be the event being ordered in — a code verified for
 * event A can never place an order in event B.
 */
create or replace function public.place_verified_order(
  p_token_hash    text,
  p_event_slug    text,
  p_restaurant_id uuid,
  p_menu_item_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.phone_verifications%rowtype;
  v_target   record;
  v_customer public.customers%rowtype;
begin
  if coalesce(btrim(p_token_hash), '') = '' then
    raise exception 'NOT_VERIFIED' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.phone_verifications
  where session_token_hash = p_token_hash;

  if not found or v_row.status <> 'verified' then
    raise exception 'NOT_VERIFIED' using errcode = 'P0001';
  end if;
  if v_row.session_expires_at is not null and v_row.session_expires_at <= now() then
    raise exception 'VERIFICATION_EXPIRED' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.resolve_order_target(p_event_slug, p_restaurant_id, p_menu_item_id);

  if v_target.event_id <> v_row.event_id then
    raise exception 'EVENT_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.customers (name, email, phone, phone_verified)
  values (v_row.name, null, v_row.phone, true)
  on conflict (phone) do update
    set name           = excluded.name,
        phone_verified = true,
        updated_at     = now()
  returning * into v_customer;

  return public.create_order_core(
    v_customer.id, v_row.phone, v_target.event_id, v_target.order_prefix,
    v_target.restaurant_id, v_target.menu_item_id, v_target.unit_price,
    v_target.item_name_en, v_target.item_name_ar, null,
    jsonb_build_object('verification_id', v_row.id)
  );
end;
$$;

-- =============================================================
-- 7. Grants — every function above is server-side only.
-- =============================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.resolve_order_target(text, uuid, uuid)',
    'public.create_order_core(uuid, text, uuid, text, uuid, uuid, numeric, text, text, uuid, jsonb)',
    'public.expire_stale_verifications()',
    'public.request_phone_verification(text, text, text, text, text, integer, text, integer, integer)',
    'public.confirm_phone_verification(text, text, text, integer, integer)',
    'public.verification_session(text)',
    'public.place_verified_order(text, text, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke all on function public.place_order(uuid, text, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, uuid, uuid, text, text)
  to service_role;

-- =============================================================
-- 8. RLS — verification rows are never readable from a browser.
-- =============================================================
alter table public.phone_verifications enable row level security;

drop policy if exists phone_verifications_admin_read on public.phone_verifications;
create policy phone_verifications_admin_read on public.phone_verifications
  for select to authenticated
  using (public.is_admin());
