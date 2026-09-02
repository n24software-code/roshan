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
