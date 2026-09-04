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
  '0005_remove_phone_verification_add_event_identity.sql',
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
    p_device_id: '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
  return db.query(`select public.place_order($1,$2,$3,$4,$5,$6,$7,$8) as result`, [
    args.p_auth_user_id,
    args.p_phone,
    args.p_event_slug,
    args.p_restaurant_id,
    args.p_menu_item_id,
    args.p_name,
    args.p_email,
    args.p_device_id,
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

console.log('\nOne order per event, per phone and per email');
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

  for (const [label, phone] of [
    ['05 5111 0001', '05 5111 0001'],
    ['966551110001', '966551110001'],
    ['00966551110001', '00966551110001'],
    ['٠٥٥١١١٠٠٠١ (Arabic-Indic)', '٠٥٥١١١٠٠٠١'],
  ]) {
    const formatted = (await place({ p_phone: phone, p_email: 'someone-else@example.com' })).rows[0]
      .result;
    check(`same phone written as ${label} is refused`, formatted.result === 'duplicate');
  }

  const sameEmail = (
    await place({
      p_auth_user_id: userB,
      p_phone: '+966551110002',
      p_email: 'GUEST@Example.com  ',
    })
  ).rows[0].result;
  check(
    'a different phone with the same email (any case) is refused',
    sameEmail.result === 'duplicate',
  );
  check(
    'the duplicate response returns the guest their existing order',
    sameEmail.order.order_number === payload.order.order_number,
  );

  const { rows: counted } = await db.query('select count(*) as n from public.orders');
  check('exactly one order exists', Number(counted[0].n) === 1, `found ${counted[0].n}`);

  const attempts = await one(
    `select count(*) as n from public.admin_audit_logs where action = 'order.duplicate_attempt'`,
  );
  check(
    'duplicate attempts are recorded for staff',
    Number(attempts.n) === 6,
    `found ${attempts.n}`,
  );
}

console.log('\nA second event is a fresh start for the same guest');
{
  const second = await one(
    `insert into public.events (slug, name_en, name_ar, order_prefix, status)
     values ('fixture-event-two', 'Second Event', 'الفعالية الثانية', 'B', 'active')
     returning id`,
  );
  await db.query(`insert into public.event_restaurants (event_id, restaurant_id) values ($1, $2)`, [
    second.id,
    kfc.id,
  ]);

  const again = (await place({ p_event_slug: 'fixture-event-two' })).rows[0].result;
  check('the same phone and email may order again at another event', again.result === 'created');
  check("and gets that event's own order prefix", /^B-\d+$/.test(again.order.order_number));

  const repeat = (await place({ p_event_slug: 'fixture-event-two' })).rows[0].result;
  check('but still only once there', repeat.result === 'duplicate');
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
await expectError('a caller with no session is refused', 'NOT_AUTHENTICATED', {
  p_auth_user_id: null,
});
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
    'a second order for the same event + phone is rejected by the index',
    `insert into public.orders (order_number, event_id, customer_id, restaurant_id, menu_item_id,
                                unit_price, item_name_en, item_name_ar,
                                normalized_phone, normalized_email)
     select 'DUP-1', o.event_id, o.customer_id, o.restaurant_id, o.menu_item_id,
            o.unit_price, o.item_name_en, o.item_name_ar,
            o.normalized_phone, 'someone-completely-different@example.com'
     from public.orders o limit 1`,
  );
  await violates(
    'a second order for the same event + email is rejected by the index',
    `insert into public.orders (order_number, event_id, customer_id, restaurant_id, menu_item_id,
                                unit_price, item_name_en, item_name_ar,
                                normalized_phone, normalized_email)
     select 'DUP-2', o.event_id, o.customer_id, o.restaurant_id, o.menu_item_id,
            o.unit_price, o.item_name_en, o.item_name_ar,
            '+966559999999', o.normalized_email
     from public.orders o limit 1`,
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

  const { rows: identity } = await db.query(`
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'orders'
      and indexname in ('orders_event_phone_key', 'orders_event_email_key')
    order by indexname
  `);
  check(
    'UNIQUE(event_id, normalized_phone) and UNIQUE(event_id, normalized_email) exist',
    identity.length === 2,
    identity.map((i) => i.indexname).join(', '),
  );

  const { rows: notNull } = await db.query(`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name in ('normalized_phone', 'normalized_email')
  `);
  check(
    'the duplicate key columns are NOT NULL, so no order can dodge the index',
    notNull.length === 2 && notNull.every((c) => c.is_nullable === 'NO'),
    JSON.stringify(notNull),
  );

  const { rows: verified } = await db.query(`
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'phone_verified'
  `);
  check('customers.phone_verified is gone', verified.length === 0);
}

console.log('\nPhone and email normalization');
{
  const forms = await one(`
    select public.normalize_saudi_phone('0551234567')       as national,
           public.normalize_saudi_phone('+966551234567')    as e164,
           public.normalize_saudi_phone('966551234567')     as international,
           public.normalize_saudi_phone('00966551234567')   as zero_zero,
           public.normalize_saudi_phone('+966 55 123 4567') as spaced,
           public.normalize_saudi_phone('٠٥٥١٢٣٤٥٦٧')       as arabic,
           public.normalize_saudi_phone('+971501234567')    as foreign_number,
           public.normalize_saudi_phone('0521234567')       as unassigned
  `);
  check(
    'every accepted Saudi format resolves to one value',
    ['national', 'e164', 'international', 'zero_zero', 'spaced', 'arabic'].every(
      (key) => forms[key] === '+966551234567',
    ),
    JSON.stringify(forms),
  );
  check('a non-Saudi number normalizes to null', forms.foreign_number === null);
  check('an unassigned Saudi prefix normalizes to null', forms.unassigned === null);

  const emails = await one(`
    select public.normalize_email('  Ahmed@GMAIL.COM ') as mixed,
           public.normalize_email('ahmed@gmail.com')    as plain,
           public.normalize_email('a.h.med@gmail.com')  as dotted,
           public.normalize_email('   ')                as blank
  `);
  check('email normalization is trim + lowercase', emails.mixed === emails.plain);
  check('and nothing else — dots are preserved', emails.dotted === 'a.h.med@gmail.com');
  check('a blank email normalizes to null', emails.blank === null);

  // The trigger backstops a direct insert that bypasses place_order.
  const thirdEvent = await one(
    `insert into public.events (slug, name_en, name_ar, order_prefix, status)
     values ('fixture-event-three', 'Third Event', 'الفعالية الثالثة', 'C', 'active')
     returning id`,
  );
  const raw = await one(
    `insert into public.orders (order_number, event_id, customer_id, restaurant_id, menu_item_id,
                                unit_price, item_name_en, item_name_ar,
                                normalized_phone, normalized_email)
     select 'RAW-1', $1, c.id, $2, $3, 1, 'x', 'x', '0551110001', '  MIXED@Case.COM '
     from public.customers c where c.phone = '+966551110001'
     returning normalized_phone, normalized_email`,
    [thirdEvent.id, kfc.id, twister.id],
  ).catch((error) => ({ error: error.message }));
  check(
    'a direct insert is normalized by the trigger before it reaches the index',
    raw?.normalized_phone === '+966551110001' && raw?.normalized_email === 'mixed@case.com',
    JSON.stringify(raw),
  );
  await db.query(`delete from public.orders where order_number = 'RAW-1'`);
  await db.query(`delete from public.events where slug = 'fixture-event-three'`);
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

  const ordersBefore = await one(
    'select count(*) as n from public.orders where restaurant_id = $1',
    [kfc.id],
  );

  await db.query(`update public.restaurants set status = 'disabled' where id = $1`, [kfc.id]);
  const disabledNotice = await one(
    `select count(*) as n from public.notifications where type = 'restaurant.disabled'`,
  );
  check('disabling a restaurant raises a notification', Number(disabledNotice.n) >= 1);

  const ordersIntact = await one(
    'select count(*) as n from public.orders where restaurant_id = $1',
    [kfc.id],
  );
  check(
    'existing orders survive the restaurant being disabled',
    Number(ordersIntact.n) === Number(ordersBefore.n) && Number(ordersBefore.n) > 0,
    `${ordersBefore.n} before, ${ordersIntact.n} after`,
  );
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

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
