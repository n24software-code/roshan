/**
 * The per-event duplicate rule, exercised against a real Postgres.
 *
 * PGlite runs the actual migrations in-process, so these tests check the
 * database behaviour itself — the RPC, the normalization functions and the
 * unique indexes — with no Supabase project and no credentials involved.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const MIGRATIONS = [
  '0001_init.sql',
  '0002_functions.sql',
  '0003_rls.sql',
  '0004_storage.sql',
  '0005_remove_phone_verification_add_event_identity.sql',
  '0006_order_items_one_per_category.sql',
];

/** Supabase-specific objects PGlite does not ship. */
const STUBS = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), phone text, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid
  );
  alter table storage.objects enable row level security;
`;

type PlaceResult = {
  result: 'created' | 'duplicate';
  order: {
    order_number: string;
    id: string;
    total_price: number;
    items: { id: string; name_en: string; unit_price: number; category_id: string | null }[];
  };
};

describe('event-level duplicate protection', () => {
  let db: PGlite;
  const ids = { restaurant: '', item: '', otherItem: '', dip: '', drink: '', user: '' };
  const cats = { mains: '', dips: '', drinks: '' };

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];

  /** Calls the RPC exactly as the server action does. */
  async function place(overrides: Record<string, unknown> = {}): Promise<PlaceResult> {
    const args = {
      p_auth_user_id: ids.user,
      p_phone: '0551234567',
      p_event_slug: 'event-a',
      p_restaurant_id: ids.restaurant,
      p_menu_item_ids: [ids.item],
      p_name: 'Ahmed',
      p_email: 'ahmed@gmail.com',
      p_device_id: '11111111-2222-4333-8444-555555555555',
      ...overrides,
    };
    const row = await one<{ result: PlaceResult }>(
      'select public.place_order($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [
        args.p_auth_user_id,
        args.p_phone,
        args.p_event_slug,
        args.p_restaurant_id,
        args.p_menu_item_ids,
        args.p_name,
        args.p_email,
        args.p_device_id,
      ],
    );
    return row.result;
  }

  const orderCount = async (slug: string) =>
    Number(
      (
        await one<{ n: string }>(
          `select count(*) as n from public.orders o
           join public.events e on e.id = o.event_id where e.slug = $1`,
          [slug],
        )
      ).n,
    );

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(STUBS);
    for (const file of MIGRATIONS) await db.exec(read(`supabase/migrations/${file}`));

    ids.user = (
      await one<{ id: string }>('insert into auth.users (phone) values (null) returning id')
    ).id;

    for (const [slug, prefix] of [
      ['event-a', 'A'],
      ['event-b', 'B'],
    ]) {
      await db.query(
        `insert into public.events (slug, name_en, name_ar, order_prefix, status)
         values ($1, $1, $1, $2, 'active')`,
        [slug, prefix],
      );
    }

    ids.restaurant = (
      await one<{ id: string }>(
        `insert into public.restaurants (slug, name_en, name_ar, status)
         values ('kitchen', 'Kitchen', 'مطبخ', 'active') returning id`,
      )
    ).id;

    await db.query(
      `insert into public.event_restaurants (event_id, restaurant_id)
       select id, $1 from public.events`,
      [ids.restaurant],
    );

    const insertCategory = async (name: string, order: number) =>
      (
        await one<{ id: string }>(
          `insert into public.menu_categories (restaurant_id, name_en, name_ar, display_order)
           values ($1, $2, $2, $3) returning id`,
          [ids.restaurant, name, order],
        )
      ).id;

    cats.mains = await insertCategory('Mains', 1);
    cats.dips = await insertCategory('Dips', 2);
    cats.drinks = await insertCategory('Drinks', 3);

    const insertItem = async (name: string, price: number, categoryId: string) =>
      (
        await one<{ id: string }>(
          `insert into public.menu_items (restaurant_id, category_id, name_en, name_ar, price)
           values ($1, $2, $3, $3, $4) returning id`,
          [ids.restaurant, categoryId, name, price],
        )
      ).id;

    ids.item = await insertItem('Burger', 32, cats.mains);
    ids.otherItem = await insertItem('Wagyu', 199.5, cats.mains);
    ids.dip = await insertItem('BBQ', 5, cats.dips);
    ids.drink = await insertItem('Orange Juice', 20, cats.drinks);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  // --------------------------------------------------------------- Test 1
  it('creates the order for a customer who has not ordered at this event', async () => {
    const result = await place();

    expect(result.result).toBe('created');
    expect(result.order.order_number).toMatch(/^A-\d+$/);
    expect(await orderCount('event-a')).toBe(1);
  });

  // --------------------------------------------------------------- Test 2
  it('rejects the same phone with a different email', async () => {
    const result = await place({ p_email: 'someone-else@gmail.com', p_name: 'Ahmed Ali' });

    expect(result.result).toBe('duplicate');
    expect(await orderCount('event-a')).toBe(1);
  });

  // --------------------------------------------------------------- Test 3
  it('rejects the same email with a different phone', async () => {
    const result = await place({ p_phone: '0552222222', p_name: 'Another Person' });

    expect(result.result).toBe('duplicate');
    expect(await orderCount('event-a')).toBe(1);
  });

  // --------------------------------------------------------------- Test 4
  it('rejects the same phone and email, and hands back the existing order', async () => {
    const first = await one<{ order_number: string }>(
      `select order_number from public.orders order by created_at limit 1`,
    );
    const result = await place({ p_menu_item_ids: [ids.otherItem] });

    expect(result.result).toBe('duplicate');
    expect(result.order.order_number).toBe(first.order_number);
    expect(await orderCount('event-a')).toBe(1);
  });

  // --------------------------------------------------------------- Test 6
  it.each([
    ['0551234567', 'national'],
    ['+966551234567', 'E.164'],
    ['966551234567', 'international without plus'],
    ['00966551234567', '00 prefix'],
    ['+966 55 123 4567', 'spaced'],
    ['055-123-4567', 'dashed'],
    ['٠٥٥١٢٣٤٥٦٧', 'Arabic-Indic digits'],
  ])('treats %s (%s) as the same phone', async (phone) => {
    const result = await place({ p_phone: phone, p_email: `unused-${Date.now()}@gmail.com` });

    expect(result.result).toBe('duplicate');
    expect(await orderCount('event-a')).toBe(1);
  });

  // --------------------------------------------------------------- Test 7
  it.each(['Ahmed@Gmail.com', 'AHMED@GMAIL.COM', '  ahmed@gmail.com  '])(
    'treats %s as the same email',
    async (email) => {
      const result = await place({ p_phone: '0559999999', p_email: email });

      expect(result.result).toBe('duplicate');
      expect(await orderCount('event-a')).toBe(1);
    },
  );

  // --------------------------------------------------------------- Test 5
  it('lets the same customer order again at a different event', async () => {
    const result = await place({ p_event_slug: 'event-b' });

    expect(result.result).toBe('created');
    expect(result.order.order_number).toMatch(/^B-\d+$/);
    expect(await orderCount('event-b')).toBe(1);

    // ...but still only once there.
    expect((await place({ p_event_slug: 'event-b' })).result).toBe('duplicate');
    expect(await orderCount('event-b')).toBe(1);
  });

  // --------------------------------------------------------------- Test 8
  it('relies on the unique index, not the pre-check, as the final guard', async () => {
    // Simulates the race the pre-check cannot win: two requests that both
    // observed "no existing order" and both reach the INSERT.
    const template = await one<Record<string, unknown>>(
      `select event_id, customer_id, restaurant_id, menu_item_id, unit_price,
              item_name_en, item_name_ar, normalized_phone, normalized_email
       from public.orders o join public.events e on e.id = o.event_id
       where e.slug = 'event-a'`,
    );

    const insertRaw = (orderNumber: string, phone: string, email: string) =>
      db.query(
        `insert into public.orders (order_number, event_id, customer_id, restaurant_id,
                                    menu_item_id, unit_price, item_name_en, item_name_ar,
                                    normalized_phone, normalized_email)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          orderNumber,
          template.event_id,
          template.customer_id,
          template.restaurant_id,
          template.menu_item_id,
          template.unit_price,
          template.item_name_en,
          template.item_name_ar,
          phone,
          email,
        ],
      );

    await expect(
      insertRaw('RACE-1', template.normalized_phone as string, 'brand-new@gmail.com'),
    ).rejects.toThrow(/orders_event_phone_key|unique/i);

    await expect(
      insertRaw('RACE-2', '+966558888888', template.normalized_email as string),
    ).rejects.toThrow(/orders_event_email_key|unique/i);

    expect(await orderCount('event-a')).toBe(1);
  });

  // -------------------------------------------------------------- Test 11
  it('never deletes or overwrites the order the customer already has', async () => {
    const orders = await db.query<{ order_number: string; item_name_en: string }>(
      `select order_number, item_name_en from public.orders
       join public.events e on e.id = orders.event_id
       where e.slug = 'event-a'`,
    );

    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].order_number).toBe('A-1001');
    // The very first submission chose the Burger; none of the later attempts
    // (which asked for the Wagyu) changed it.
    expect(orders.rows[0].item_name_en).toBe('Burger');
  });

  it('records every duplicate attempt for staff without creating an order', async () => {
    const attempts = await one<{ n: string }>(
      `select count(*) as n from public.admin_audit_logs
       where action = 'order.duplicate_attempt'`,
    );

    expect(Number(attempts.n)).toBeGreaterThan(1);
    expect(await orderCount('event-a')).toBe(1);
  });

  it('accepts one item from each category and sums the total server-side', async () => {
    const result = await place({
      p_event_slug: 'event-b',
      p_phone: '0557000001',
      p_email: 'multi@gmail.com',
      p_menu_item_ids: [ids.item, ids.dip, ids.drink],
    });

    expect(result.result).toBe('created');
    expect(result.order.items).toHaveLength(3);
    // 32 + 5 + 20 — never taken from the caller, which sends no prices at all.
    expect(Number(result.order.total_price)).toBe(57);

    const rows = await one<{ n: string }>(
      `select count(*) as n from public.order_items where order_id = $1`,
      [result.order.id],
    );
    expect(Number(rows.n)).toBe(3);
  });

  it('refuses two items from the same category', async () => {
    await expect(
      place({
        p_phone: '0557000002',
        p_email: 'twocat@gmail.com',
        p_menu_item_ids: [ids.item, ids.otherItem],
      }),
    ).rejects.toThrow(/DUPLICATE_CATEGORY/);
  });

  it('refuses an empty selection', async () => {
    await expect(
      place({ p_phone: '0557000003', p_email: 'empty@gmail.com', p_menu_item_ids: [] }),
    ).rejects.toThrow(/NO_ITEMS_SELECTED/);
  });

  it('collapses a repeated id instead of reading it as two choices', async () => {
    const result = await place({
      p_phone: '0557000004',
      p_email: 'repeat@gmail.com',
      p_event_slug: 'event-b',
      p_menu_item_ids: [ids.dip, ids.dip, ids.dip],
    });

    // Three copies of one id are one choice, not a same-category collision.
    expect(result.result).toBe('created');
    expect(result.order.items).toHaveLength(1);
    expect(Number(result.order.total_price)).toBe(5);
  });

  it('lets the unique index stop a second item sneaking into a category', async () => {
    const order = await one<{ id: string }>(
      `select o.id from public.orders o
       join public.events e on e.id = o.event_id where e.slug = 'event-a'`,
    );

    await expect(
      db.query(
        `insert into public.order_items (order_id, menu_item_id, category_id, unit_price, item_name_en, item_name_ar)
         values ($1, $2, $3, 1, 'x', 'x')`,
        [order.id, ids.otherItem, cats.mains],
      ),
    ).rejects.toThrow(/order_items_one_per_category|unique/i);
  });

  it('keeps orders.total_price in step with its items', async () => {
    // The three-item order placed above, addressed by its own identity.
    const order = await one<{ id: string; total_price: string }>(
      `select id, total_price from public.orders where normalized_email = 'multi@gmail.com'`,
    );
    const before = Number(order.total_price);
    expect(before).toBe(57);

    await db.query(`delete from public.order_items where order_id = $1 and category_id = $2`, [
      order.id,
      cats.drinks,
    ]);

    const after = await one<{ total_price: string }>(
      `select total_price from public.orders where id = $1`,
      [order.id],
    );
    expect(Number(after.total_price)).toBe(before - 20);
  });

  it('refuses to place an order without an anonymous session', async () => {
    await expect(place({ p_auth_user_id: null, p_phone: '0557777777' })).rejects.toThrow(
      /NOT_AUTHENTICATED/,
    );
  });

  it('stores the anonymous user and device id on the order it creates', async () => {
    const row = await one<{ auth_user_id: string; device_id: string }>(
      `select auth_user_id, device_id from public.orders order by created_at limit 1`,
    );

    expect(row.auth_user_id).toBe(ids.user);
    expect(row.device_id).toBe('11111111-2222-4333-8444-555555555555');
  });
});
