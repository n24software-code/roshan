/**
 * Executes the SQL migrations against an in-process Postgres (PGlite) and
 * exercises the business rules that the database is responsible for.
 *
 *   node scripts/verify-schema.mjs
 *
 * Supabase-specific objects that PGlite does not ship (the auth schema, the
 * built-in roles and the realtime publication) are stubbed first so the
 * migrations run unmodified.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const db = new PGlite({ extensions: { pgcrypto } });

console.log('\nSupabase stubs');
await db.exec(`
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    phone text,
    email text
  );
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
`);
check('auth schema, roles and realtime publication created', true);

console.log('\nMigrations');
for (const file of ['0001_init.sql', '0002_functions.sql', '0003_rls.sql']) {
  try {
    await db.exec(read(`supabase/migrations/${file}`));
    check(`${file} applied`, true);
  } catch (error) {
    check(`${file} applied`, false, error.message);
    process.exit(1);
  }
}

console.log('\nSeed data');
try {
  await db.exec(read('supabase/seed.sql'));
  const { rows } = await db.query(
    `select (select count(*) from public.events) as events,
            (select count(*) from public.restaurants) as restaurants,
            (select count(*) from public.menu_categories) as categories,
            (select count(*) from public.menu_items) as items`,
  );
  const seeded = rows[0];
  check('seed applied', true);
  check(
    `seeded 1 event / 4 restaurants / ${seeded.categories} categories / ${seeded.items} items`,
    Number(seeded.events) === 1 && Number(seeded.restaurants) === 4 && Number(seeded.items) > 10,
    JSON.stringify(seeded),
  );

  await db.exec(read('supabase/seed.sql'));
  const { rows: rerun } = await db.query('select count(*) as n from public.menu_items');
  check('seed is idempotent', Number(rerun[0].n) === Number(seeded.items));
} catch (error) {
  check('seed applied', false, error.message);
}

// --------------------------------------------------------------- fixtures
const uid = async (phone) => {
  const { rows } = await db.query('insert into auth.users (phone) values ($1) returning id', [
    phone,
  ]);
  return rows[0].id;
};

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const userA = await uid('966551110001');
const userB = await uid('966551110002');

const burgerHouse = await one(`select id from public.restaurants where slug = 'burger-house'`);
const coffeeLab = await one(`select id from public.restaurants where slug = 'coffee-lab'`);
const burger = await one(
  `select id, price from public.menu_items where name_en = 'Classic Beef Burger'`,
);
const wagyu = await one(`select id, price from public.menu_items where name_en = 'Lamb Mandi'`);
const tiramisu = await one(`select id from public.menu_items where name_en = 'Tiramisu'`);
const saudiBites = await one(`select id from public.restaurants where slug = 'saudi-bites'`);

const place = (overrides = {}) => {
  const args = {
    p_auth_user_id: userA,
    p_phone: '+966551110001',
    p_event_slug: 'leap-riyadh',
    p_restaurant_id: burgerHouse.id,
    p_menu_item_id: burger.id,
    p_name: 'Test Guest',
    p_email: 'guest@example.com',
    ...overrides,
  };
  return db.query(`select public.place_order($1,$2,$3,$4,$5,$6,$7) as result`, [
    args.p_auth_user_id,
    args.p_phone,
    args.p_event_slug,
    args.p_restaurant_id,
    args.p_menu_item_id,
    args.p_name,
    args.p_email,
  ]);
};

const expectError = async (label, sentinel, overrides) => {
  try {
    await place(overrides);
    check(label, false, 'no error was raised');
  } catch (error) {
    check(label, error.message.includes(sentinel), error.message);
  }
};

console.log('\nOne order per customer per event');
{
  const { rows } = await place();
  const payload = rows[0].result;
  check('first order is created', payload.result === 'created', JSON.stringify(payload));
  check(
    `order number is human readable (${payload.order?.order_number})`,
    /^A-\d+$/.test(payload.order?.order_number ?? ''),
  );
  check(
    'price comes from the database',
    Number(payload.order.unit_price) === Number(burger.price),
    `${payload.order.unit_price} vs ${burger.price}`,
  );

  const second = (await place({ p_menu_item_id: wagyu.id, p_restaurant_id: saudiBites.id })).rows[0]
    .result;
  check('a second order is refused as duplicate', second.result === 'duplicate');
  check(
    'the duplicate response returns the original order',
    second.order.order_number === payload.order.order_number,
  );

  const differentFormat = (await place({ p_phone: '+966551110001' })).rows[0].result;
  check(
    'same phone in another format resolves to the same customer',
    differentFormat.result === 'duplicate',
  );

  const { rows: counted } = await db.query('select count(*) as n from public.orders');
  check('exactly one order exists', Number(counted[0].n) === 1, `found ${counted[0].n}`);

  const attempts = await one(
    `select count(*) as n from public.admin_audit_logs where action = 'order.duplicate_attempt'`,
  );
  check('duplicate attempts are recorded for staff', Number(attempts.n) === 2, `found ${attempts.n}`);
}

console.log('\nServer-side validation');
await expectError('disabled restaurant is refused', 'RESTAURANT_DISABLED', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_restaurant_id: coffeeLab.id,
  p_menu_item_id: (await one(`select id from public.menu_items where name_en = 'Saudi Qahwa'`)).id,
});
await expectError('unavailable item is refused', 'ITEM_UNAVAILABLE', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_restaurant_id: (await one(`select id from public.restaurants where slug = 'italian-kitchen'`))
    .id,
  p_menu_item_id: tiramisu.id,
});
await expectError('item from another restaurant is refused', 'ITEM_RESTAURANT_MISMATCH', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_menu_item_id: wagyu.id,
});
await expectError('unverified caller is refused', 'NOT_VERIFIED', { p_auth_user_id: null });
await expectError('non-Saudi phone is refused', 'INVALID_PHONE', {
  p_auth_user_id: userB,
  p_phone: '+971501234567',
});
await expectError('unknown event is refused', 'EVENT_NOT_FOUND', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_event_slug: 'no-such-event',
});
await expectError('invalid email is refused', 'INVALID_EMAIL', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_email: 'not-an-email',
});

console.log('\nInactive event');
{
  await db.exec(`update public.events set status = 'inactive' where slug = 'leap-riyadh'`);
  await expectError('inactive event is refused', 'EVENT_INACTIVE', {
    p_auth_user_id: userB,
    p_phone: '+966551110002',
  });
  await db.exec(`update public.events set status = 'active' where slug = 'leap-riyadh'`);
}

console.log('\nDatabase constraints');
{
  const violates = async (label, sql) => {
    try {
      await db.exec(sql);
      check(label, false, 'the insert was allowed');
    } catch (error) {
      check(label, true);
      void error;
    }
  };

  await violates(
    'a negative price is rejected',
    `insert into public.menu_items (restaurant_id, name_en, name_ar, price)
     values ('${burgerHouse.id}', 'Bad', 'سيء', -1)`,
  );
  await violates(
    'a non-Saudi phone is rejected by the customers table',
    `insert into public.customers (name, email, phone)
     values ('X', 'x@y.com', '+971501234567')`,
  );
  await violates(
    'a duplicate phone is rejected',
    `insert into public.customers (name, email, phone)
     values ('X', 'x@y.com', '+966551110001')`,
  );
  await violates(
    'a menu item cannot use another restaurant’s category',
    `insert into public.menu_items (restaurant_id, category_id, name_en, name_ar, price)
     select '${burgerHouse.id}', c.id, 'Bad', 'سيء', 10
     from public.menu_categories c
     join public.restaurants r on r.id = c.restaurant_id
     where r.slug = 'italian-kitchen' limit 1`,
  );

  const { rows: constraint } = await db.query(`
    select 1 from pg_constraint
    where conname = 'orders_one_per_customer_per_event' and contype = 'u'
  `);
  check('UNIQUE(event_id, customer_id) exists on orders', constraint.length === 1);
}

console.log('\nStatus history and notifications');
{
  const order = await one('select id, status from public.orders limit 1');
  const history = await one(
    'select count(*) as n from public.order_status_history where order_id = $1',
    [order.id],
  );
  check('order creation is logged in history', Number(history.n) === 1);

  const notification = await one(
    `select count(*) as n from public.notifications where order_id = $1 and type = 'order.created'`,
    [order.id],
  );
  check('order creation raises an admin notification', Number(notification.n) === 1);

  await db.query(`update public.orders set status = 'accepted' where id = $1`, [order.id]);
  const afterUpdate = await one(
    'select count(*) as n from public.order_status_history where order_id = $1',
    [order.id],
  );
  check('a status change is appended to history', Number(afterUpdate.n) === 2);

  await db.query(
    `update public.orders set status = 'cancelled', cancel_reason = 'Kitchen closed' where id = $1`,
    [order.id],
  );
  const cancelNotice = await one(
    `select count(*) as n from public.notifications where order_id = $1 and type = 'order.cancelled'`,
    [order.id],
  );
  check('cancelling raises a notification', Number(cancelNotice.n) === 1);

  const stillThere = await one('select count(*) as n from public.orders where id = $1', [order.id]);
  check('cancelled orders stay in history', Number(stillThere.n) === 1);

  await db.query(`update public.restaurants set status = 'disabled' where id = $1`, [
    burgerHouse.id,
  ]);
  const disabledNotice = await one(
    `select count(*) as n from public.notifications where type = 'restaurant.disabled'`,
  );
  check('disabling a restaurant raises a notification', Number(disabledNotice.n) >= 1);

  const ordersIntact = await one(
    'select count(*) as n from public.orders where restaurant_id = $1',
    [burgerHouse.id],
  );
  check('existing orders survive the restaurant being disabled', Number(ordersIntact.n) === 1);
}

console.log('\nRow level security');
{
  const { rows } = await db.query(`
    select relname, relrowsecurity
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
    order by relname
  `);
  const without = rows.filter((row) => !row.relrowsecurity).map((row) => row.relname);
  check('RLS is enabled on every public table', without.length === 0, without.join(', '));

  const { rows: policies } = await db.query(
    `select tablename, count(*) as n from pg_policies where schemaname = 'public' group by tablename`,
  );
  check(
    `policies exist on ${policies.length} tables`,
    policies.length >= 11,
    policies.map((p) => `${p.tablename}:${p.n}`).join(' '),
  );

  const { rows: grants } = await db.query(`
    select has_function_privilege('anon', p.oid, 'execute') as anon_can_call
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'place_order'
  `);
  check('anon cannot execute place_order', grants[0]?.anon_can_call === false);
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
