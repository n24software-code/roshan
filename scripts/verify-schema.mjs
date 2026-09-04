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

  -- Minimal stand-ins for the Storage schema, so 0004 can be verified here too.
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;
`);
check('auth schema, roles and realtime publication created', true);

console.log('\nMigrations');
for (const file of [
  '0001_init.sql',
  '0002_functions.sql',
  '0003_rls.sql',
  '0004_storage.sql',
  '0005_phone_verification.sql',
]) {
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
    `seeded 1 event / ${seeded.restaurants} restaurant / ${seeded.categories} categories / ${seeded.items} items`,
    Number(seeded.events) === 1 &&
      Number(seeded.restaurants) === 1 &&
      Number(seeded.categories) === 3 &&
      Number(seeded.items) === 15,
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

// The seeded restaurant and two of its items.
const kfc = await one(`select id from public.restaurants where slug = 'kfc'`);
const twister = await one(
  `select id, price from public.menu_items where name_en = 'Twister Combo'`,
);
const fries = await one(`select id, price from public.menu_items where name_en = 'Fries (Medium)'`);

// Fixtures owned by this script, so the checks do not depend on which menu is
// seeded: a disabled restaurant, a second active restaurant, and a sold-out item.
const eventId = (await one(`select id from public.events where slug = 'leap-riyadh'`)).id;

async function makeRestaurant(slug, status) {
  const r = await one(
    `insert into public.restaurants (slug, name_en, name_ar, status)
     values ($1, $2, $2, $3) returning id`,
    [slug, `Fixture ${slug}`, status],
  );
  await db.query(`insert into public.event_restaurants (event_id, restaurant_id) values ($1, $2)`, [
    eventId,
    r.id,
  ]);
  return r;
}
async function makeItem(restaurantId, name, price, available = true) {
  return one(
    `insert into public.menu_items (restaurant_id, name_en, name_ar, price, is_available)
     values ($1, $2, $2, $3, $4) returning id, price`,
    [restaurantId, name, price, available],
  );
}

const closedRestaurant = await makeRestaurant('fixture-closed', 'disabled');
const closedItem = await makeItem(closedRestaurant.id, 'Fixture Closed Item', 25);
const otherRestaurant = await makeRestaurant('fixture-other', 'active');
const otherItem = await makeItem(otherRestaurant.id, 'Fixture Other Item', 30);
const otherCategory = await one(
  `insert into public.menu_categories (restaurant_id, name_en, name_ar)
   values ($1, 'Fixture Category', 'Fixture Category') returning id`,
  [otherRestaurant.id],
);
const soldOutItem = await makeItem(kfc.id, 'Fixture Sold Out', 20, false);

const place = (overrides = {}) => {
  const args = {
    p_auth_user_id: userA,
    p_phone: '+966551110001',
    p_event_slug: 'leap-riyadh',
    p_restaurant_id: kfc.id,
    p_menu_item_id: twister.id,
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
    Number(payload.order.unit_price) === Number(twister.price),
    `${payload.order.unit_price} vs ${twister.price}`,
  );

  const second = (await place({ p_menu_item_id: fries.id })).rows[0].result;
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
  check(
    'duplicate attempts are recorded for staff',
    Number(attempts.n) === 2,
    `found ${attempts.n}`,
  );
}

console.log('\nServer-side validation');
await expectError('disabled restaurant is refused', 'RESTAURANT_DISABLED', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_restaurant_id: closedRestaurant.id,
  p_menu_item_id: closedItem.id,
});
await expectError('unavailable item is refused', 'ITEM_UNAVAILABLE', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_menu_item_id: soldOutItem.id,
});
await expectError('item from another restaurant is refused', 'ITEM_RESTAURANT_MISMATCH', {
  p_auth_user_id: userB,
  p_phone: '+966551110002',
  p_menu_item_id: otherItem.id,
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
     values ('${kfc.id}', 'Bad', 'سيء', -1)`,
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
     values ('${kfc.id}', '${otherCategory.id}', 'Bad', 'سيء', 10)`,
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

  await db.query(`update public.restaurants set status = 'disabled' where id = $1`, [kfc.id]);
  const disabledNotice = await one(
    `select count(*) as n from public.notifications where type = 'restaurant.disabled'`,
  );
  check('disabling a restaurant raises a notification', Number(disabledNotice.n) >= 1);

  const ordersIntact = await one(
    'select count(*) as n from public.orders where restaurant_id = $1',
    [kfc.id],
  );
  check('existing orders survive the restaurant being disabled', Number(ordersIntact.n) === 1);
}

console.log('\nImage storage');
{
  const bucket = await one(`select * from storage.buckets where id = 'menu-images'`);
  check('menu-images bucket exists', Boolean(bucket));
  check('bucket is public (storefront reads anonymously)', bucket?.public === true);
  check(
    `bucket enforces a 5 MB limit (${bucket?.file_size_limit})`,
    Number(bucket?.file_size_limit) === 5242880,
  );
  check(
    'bucket allows only jpeg/png/webp',
    JSON.stringify(bucket?.allowed_mime_types) ===
      JSON.stringify(['image/jpeg', 'image/png', 'image/webp']),
    JSON.stringify(bucket?.allowed_mime_types),
  );

  const { rows: policies } = await db.query(
    `select policyname, cmd from pg_policies
     where schemaname = 'storage' and tablename = 'objects' order by policyname`,
  );
  const names = policies.map((p) => p.policyname);
  check(
    `storage policies: ${names.join(', ')}`,
    names.length === 4 &&
      names.includes('menu_images_public_read') &&
      names.includes('menu_images_admin_insert') &&
      names.includes('menu_images_admin_update') &&
      names.includes('menu_images_admin_delete'),
  );
  check('only reads are granted to anon', policies.filter((p) => p.cmd === 'SELECT').length === 1);
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

// =============================================================
// Phone verification + one verified phone = one order per event
// =============================================================
const VPHONE = '+966551110010';
const VPHONE_2 = '+966551110011';
const VPHONE_3 = '+966551110012';

// A second event, so the "uniqueness is scoped to the event" rule is testable.
const secondEvent = await one(
  `insert into public.events (slug, name_en, name_ar, order_prefix, status)
   values ('fixture-event-two', 'Fixture Event Two', 'Fixture Event Two', 'B', 'active')
   returning id`,
);
await db.query(`insert into public.event_restaurants (event_id, restaurant_id) values ($1, $2)`, [
  secondEvent.id,
  otherRestaurant.id,
]);

const requestVerification = (overrides = {}) => {
  const args = {
    p_event_slug: 'leap-riyadh',
    p_phone: VPHONE,
    p_name: 'Hamid',
    p_code_hash: 'hash-code-1',
    p_token_hash: 'hash-token-1',
    p_code_ttl_seconds: 600,
    p_provider: 'dev',
    p_resend_cooldown_seconds: 30,
    p_max_per_hour: 5,
    ...overrides,
  };
  return db.query(
    `select public.request_phone_verification($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
    [
      args.p_event_slug,
      args.p_phone,
      args.p_name,
      args.p_code_hash,
      args.p_token_hash,
      args.p_code_ttl_seconds,
      args.p_provider,
      args.p_resend_cooldown_seconds,
      args.p_max_per_hour,
    ],
  );
};

const confirm = (phone, codeHash) =>
  db.query(`select public.confirm_phone_verification($1,$2,'dev',5,21600) as result`, [
    phone,
    codeHash,
  ]);

const sessionOf = async (tokenHash) =>
  (await one(`select public.verification_session($1) as result`, [tokenHash])).result;

const placeVerified = (tokenHash, overrides = {}) => {
  const args = {
    p_event_slug: 'leap-riyadh',
    p_restaurant_id: otherRestaurant.id,
    p_menu_item_id: otherItem.id,
    ...overrides,
  };
  return db.query(`select public.place_verified_order($1,$2,$3,$4) as result`, [
    tokenHash,
    args.p_event_slug,
    args.p_restaurant_id,
    args.p_menu_item_id,
  ]);
};

console.log('\nVerification requests');
{
  const { rows } = await requestVerification();
  const payload = rows[0].result;
  check('a verification request is created', payload.result === 'created', JSON.stringify(payload));
  check('the request carries an expiry', Boolean(payload.expires_at));

  const stored = await one(
    `select code_hash, status, attempts from public.phone_verifications where phone = $1`,
    [VPHONE],
  );
  check('only a hash of the code is stored', stored.code_hash === 'hash-code-1');
  check('the request starts out pending', stored.status === 'pending');

  try {
    await requestVerification({ p_code_hash: 'hash-code-2', p_token_hash: 'hash-token-2' });
    check('a second request inside the cooldown is refused', false, 'no error was raised');
  } catch (error) {
    check(
      'a second request inside the cooldown is refused',
      error.message.includes('RESEND_TOO_SOON'),
    );
  }

  try {
    await requestVerification({ p_phone: '+971501234567' });
    check('a non-Saudi number cannot request verification', false, 'no error was raised');
  } catch (error) {
    check(
      'a non-Saudi number cannot request verification',
      error.message.includes('INVALID_PHONE'),
    );
  }
}

console.log('\nCode confirmation');
{
  const wrong = (await confirm(VPHONE, 'not-the-code')).rows[0].result;
  check('a wrong code does not verify', wrong.result === 'no_match');

  const afterWrong = await one(`select attempts from public.phone_verifications where phone = $1`, [
    VPHONE,
  ]);
  check('a wrong code burns an attempt', Number(afterWrong.attempts) === 1);

  const fromAnotherNumber = (await confirm(VPHONE_2, 'hash-code-1')).rows[0].result;
  check(
    'the right code sent from another number does not verify',
    fromAnotherNumber.result === 'no_match',
  );

  const right = (await confirm(VPHONE, 'hash-code-1')).rows[0].result;
  check('the right code from the right number verifies', right.result === 'verified');

  const stored = await one(
    `select code_hash, status, session_expires_at from public.phone_verifications where phone = $1`,
    [VPHONE],
  );
  check('the code hash is destroyed once used', stored.code_hash === null);
  check('the row is marked verified', stored.status === 'verified');
  check('a verified session gets an expiry', Boolean(stored.session_expires_at));

  const replay = (await confirm(VPHONE, 'hash-code-1')).rows[0].result;
  check('the same code cannot be replayed', replay.result === 'no_match');

  const session = await sessionOf('hash-token-1');
  check('the session cookie resolves to a verified state', session.status === 'verified');
  check('an unknown cookie resolves to nothing', (await sessionOf('nope')).status === 'none');
}

console.log('\nOne verified phone = one order per event');
{
  const first = (await placeVerified('hash-token-1')).rows[0].result;
  check('a verified attendee can order', first.result === 'created', JSON.stringify(first));
  check('the order stores the normalized phone', first.order.customer.phone === VPHONE);

  const again = (await placeVerified('hash-token-1')).rows[0].result;
  check('a second order for the same event is refused', again.result === 'duplicate');
  check(
    'the duplicate response returns the original order',
    again.order.order_number === first.order.order_number,
  );

  // A brand new verification for the same number must not open a second door.
  await db.query(
    `update public.phone_verifications set created_at = created_at - interval '1 minute'
     where phone = $1`,
    [VPHONE],
  );
  const reRequest = (
    await requestVerification({ p_code_hash: 'hash-code-3', p_token_hash: 'hash-token-3' })
  ).rows[0].result;
  check(
    're-verifying a number that already ordered issues a fresh code',
    reRequest.result === 'created',
  );

  // ...and that fresh, still-pending session is told nothing about the order.
  check(
    'a pending session is never shown an existing order',
    (await sessionOf('hash-token-3')).order === null,
  );

  await confirm(VPHONE, 'hash-code-3');
  check(
    'once verified again, the guest gets their order number back',
    (await sessionOf('hash-token-3')).order?.customer?.phone === VPHONE,
  );

  const { rows: counted } = await db.query(
    `select count(*) as n from public.orders where customer_phone = $1`,
    [VPHONE],
  );
  check(
    'exactly one order exists for that number',
    Number(counted[0].n) === 1,
    `found ${counted[0].n}`,
  );

  // The constraint, not the lookup, is what makes this true.
  const existing = await one(`select * from public.orders where customer_phone = $1`, [VPHONE]);
  try {
    await db.query(
      `insert into public.orders (order_number, event_id, customer_id, restaurant_id,
         menu_item_id, unit_price, item_name_en, item_name_ar)
       values ('X-1', $1, $2, $3, $4, 1, 'x', 'x')`,
      [existing.event_id, existing.customer_id, existing.restaurant_id, existing.menu_item_id],
    );
    check('a direct duplicate insert is rejected by the database', false, 'the insert was allowed');
  } catch (error) {
    check(
      'a direct duplicate insert is rejected by the database',
      error.message.toLowerCase().includes('unique') ||
        error.message.includes('orders_one_per_phone_per_event'),
      error.message,
    );
  }

  const { rows: constraint } = await db.query(`
    select 1 from pg_constraint
    where conname = 'orders_one_per_phone_per_event' and contype = 'u'
  `);
  check('UNIQUE(event_id, customer_phone) exists on orders', constraint.length === 1);
}

console.log('\nVerification cannot be borrowed');
{
  const expectVerifyError = async (label, sentinel, tokenHash, overrides) => {
    try {
      await placeVerified(tokenHash, overrides);
      check(label, false, 'no error was raised');
    } catch (error) {
      check(label, error.message.includes(sentinel), error.message);
    }
  };

  await expectVerifyError('an unknown session cannot order', 'NOT_VERIFIED', 'no-such-token');

  // A pending (unverified) request for a second number.
  await requestVerification({
    p_phone: VPHONE_2,
    p_name: 'Second Guest',
    p_code_hash: 'hash-code-4',
    p_token_hash: 'hash-token-4',
  });
  await expectVerifyError('a pending session cannot order', 'NOT_VERIFIED', 'hash-token-4');

  await confirm(VPHONE_2, 'hash-code-4');
  await expectVerifyError(
    'a session verified for one event cannot order in another',
    'EVENT_MISMATCH',
    'hash-token-4',
    { p_event_slug: 'fixture-event-two' },
  );

  // ...but the same number may order in another event through its own verification.
  await db.query(
    `update public.phone_verifications set created_at = created_at - interval '1 minute'
     where phone = $1`,
    [VPHONE_2],
  );
  await requestVerification({
    p_event_slug: 'fixture-event-two',
    p_phone: VPHONE_2,
    p_name: 'Second Guest',
    p_code_hash: 'hash-code-5',
    p_token_hash: 'hash-token-5',
  });
  await confirm(VPHONE_2, 'hash-code-5');
  const otherEventOrder = (
    await placeVerified('hash-token-5', { p_event_slug: 'fixture-event-two' })
  ).rows[0].result;
  check(
    'the same number may order in a different event',
    otherEventOrder.result === 'created',
    JSON.stringify(otherEventOrder),
  );

  // An expired verified session is refused.
  await db.query(
    `update public.phone_verifications set session_expires_at = now() - interval '1 minute'
     where session_token_hash = 'hash-token-5'`,
  );
  await expectVerifyError(
    'an expired verified session is refused',
    'VERIFICATION_EXPIRED',
    'hash-token-5',
    { p_event_slug: 'fixture-event-two' },
  );

  // An expired code cannot be confirmed. A third number, because the two above
  // have both ordered and would short-circuit to their existing order.
  await requestVerification({
    p_phone: VPHONE_3,
    p_name: 'Third Guest',
    p_code_hash: 'hash-code-6',
    p_token_hash: 'hash-token-6',
  });
  await db.query(
    `update public.phone_verifications set expires_at = now() - interval '1 second'
     where session_token_hash = 'hash-token-6'`,
  );
  const expiredConfirm = (await confirm(VPHONE_3, 'hash-code-6')).rows[0].result;
  check('an expired code cannot be confirmed', expiredConfirm.result === 'no_match');
  check('the expired request is retired', (await sessionOf('hash-token-6')).status === 'expired');
}

console.log('\nVerification data is not reachable from a browser');
{
  const { rows: rls } = await db.query(
    `select relrowsecurity from pg_class where oid = 'public.phone_verifications'::regclass`,
  );
  check('RLS is enabled on phone_verifications', rls[0]?.relrowsecurity === true);

  const { rows: policies } = await db.query(
    `select policyname, cmd, roles::text from pg_policies
     where schemaname = 'public' and tablename = 'phone_verifications'`,
  );
  check(
    `the only policy is an admin read (${policies.map((p) => p.policyname).join(', ') || 'none'})`,
    policies.length === 1 && policies[0].cmd === 'SELECT',
  );

  for (const fn of [
    'request_phone_verification',
    'confirm_phone_verification',
    'verification_session',
    'place_verified_order',
  ]) {
    const { rows } = await db.query(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    check(
      `neither anon nor authenticated can execute ${fn}`,
      rows.every((row) => row.anon === false && row.auth === false),
    );
  }
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
