/**
 * End-to-end checks of the business rules that live in the database.
 *
 * These require a Supabase project with the migrations applied and a
 * service-role key, so they skip automatically when the environment is absent:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationTarget } from './guard';

const target = integrationTarget();
const { url, serviceKey, publicKey } = target;

const live = target.enabled;
const describeLive = live ? describe : describe.skip;

// Fixed test identifiers so a rerun cleans up after itself.
const SUFFIX = 'vitest-fixture';
const EVENT_SLUG = `event-${SUFFIX}`;
const OTHER_EVENT_SLUG = `event-2-${SUFFIX}`;
const RESTAURANT_SLUG = `restaurant-${SUFFIX}`;
const DISABLED_SLUG = `disabled-${SUFFIX}`;
const PHONE = '+966500000001';
const SECOND_PHONE = '+966500000002';
const EMAIL = 'guest@example.com';
const DEVICE_ID = '11111111-2222-4333-8444-555555555555';

describeLive('order placement rules', () => {
  let admin: SupabaseClient;
  const ids = {
    event: '',
    otherEvent: '',
    restaurant: '',
    disabledRestaurant: '',
    item: '',
    expensiveItem: '',
    unavailableItem: '',
    foreignItem: '',
    authUser: '',
    secondAuthUser: '',
  };

  async function cleanup() {
    const { data: customers } = await admin
      .from('customers')
      .select('id')
      .in('phone', [PHONE, SECOND_PHONE]);

    for (const customer of customers ?? []) {
      await admin.from('orders').delete().eq('customer_id', customer.id);
    }
    await admin.from('orders').delete().in('normalized_phone', [PHONE, SECOND_PHONE]);
    await admin.from('customers').delete().in('phone', [PHONE, SECOND_PHONE]);
    await admin.from('restaurants').delete().in('slug', [RESTAURANT_SLUG, DISABLED_SLUG]);
    await admin.from('events').delete().in('slug', [EVENT_SLUG, OTHER_EVENT_SLUG]);

    // Rows the fixtures caused the database to generate. Order notifications
    // cascade with their order, but a disabled-restaurant notification carries
    // no order_id, so it would otherwise outlive the restaurant that caused it.
    await admin
      .from('notifications')
      .delete()
      .eq('type', 'restaurant.disabled')
      .like('body', `%${SUFFIX}%`);

    await admin.from('admin_audit_logs').delete().in('meta->>phone', [PHONE, SECOND_PHONE]);
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await cleanup();

    const insertEvent = async (slug: string, status: 'active' | 'inactive') => {
      const { data, error } = await admin
        .from('events')
        .insert({
          slug,
          name_en: `Test ${slug}`,
          name_ar: `اختبار ${slug}`,
          order_prefix: 'T',
          status,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    };

    ids.event = await insertEvent(EVENT_SLUG, 'active');
    ids.otherEvent = await insertEvent(OTHER_EVENT_SLUG, 'inactive');

    const insertRestaurant = async (slug: string, status: 'active' | 'disabled') => {
      const { data, error } = await admin
        .from('restaurants')
        .insert({ slug, name_en: `R ${slug}`, name_ar: `م ${slug}`, status })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    };

    ids.restaurant = await insertRestaurant(RESTAURANT_SLUG, 'active');
    ids.disabledRestaurant = await insertRestaurant(DISABLED_SLUG, 'disabled');

    await admin.from('event_restaurants').insert([
      { event_id: ids.event, restaurant_id: ids.restaurant },
      { event_id: ids.event, restaurant_id: ids.disabledRestaurant },
    ]);

    const insertItem = async (
      restaurantId: string,
      name: string,
      price: number,
      isAvailable = true,
    ) => {
      const { data, error } = await admin
        .from('menu_items')
        .insert({
          restaurant_id: restaurantId,
          name_en: name,
          name_ar: name,
          price,
          is_available: isAvailable,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    };

    ids.item = await insertItem(ids.restaurant, 'Test Burger', 32);
    ids.expensiveItem = await insertItem(ids.restaurant, 'Test Wagyu', 199.5);
    ids.unavailableItem = await insertItem(ids.restaurant, 'Test Sold Out', 40, false);
    ids.foreignItem = await insertItem(ids.disabledRestaurant, 'Other Kitchen Item', 25);

    // Stand-ins for the anonymous users the browser creates. Nothing about
    // them is verified — they exist only to carry an auth.uid().
    const createUser = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error) throw error;
      return data.user!.id;
    };

    ids.authUser = await createUser(`session-1-${SUFFIX}@example.com`);
    ids.secondAuthUser = await createUser(`session-2-${SUFFIX}@example.com`);
  }, 60_000);

  afterAll(async () => {
    if (!live) return;
    await cleanup();
    for (const id of [ids.authUser, ids.secondAuthUser]) {
      if (id) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
  }, 60_000);

  const place = (overrides: Record<string, unknown> = {}) =>
    admin.rpc('place_order', {
      p_auth_user_id: ids.authUser,
      p_phone: PHONE,
      p_event_slug: EVENT_SLUG,
      p_restaurant_id: ids.restaurant,
      p_menu_item_ids: [ids.item],
      p_name: 'Test Guest',
      p_email: EMAIL,
      p_device_id: DEVICE_ID,
      ...overrides,
    });

  it('creates the first order and issues a readable order number', async () => {
    const { data, error } = await place();

    expect(error).toBeNull();
    expect(data.result).toBe('created');
    expect(data.order.order_number).toMatch(/^T-\d+$/);
    expect(Number(data.order.unit_price)).toBe(32);
  });

  it('takes the price from the database, not from the caller', async () => {
    // place_order has no price parameter at all, so an inflated or deflated
    // price cannot even be expressed by a caller.
    const { data } = await admin
      .from('orders')
      .select('unit_price')
      .eq('menu_item_id', ids.item)
      .maybeSingle();

    expect(Number(data!.unit_price)).toBe(32);
  });

  it('blocks a second order for the same event, whatever the guest changes', async () => {
    const second = await place({ p_menu_item_ids: [ids.expensiveItem] });
    expect(second.data.result).toBe('duplicate');

    const third = await place({
      p_menu_item_ids: [ids.expensiveItem],
      p_name: 'Different Name',
    });
    expect(third.data.result).toBe('duplicate');

    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ids.event);
    expect(count).toBe(1);
  });

  it('recognises the same person from a differently formatted phone number', async () => {
    for (const phone of ['0500000001', '966500000001', '00966500000001', '+966 50 000 0001']) {
      const { data } = await place({ p_phone: phone, p_email: `other-${SUFFIX}@example.com` });
      expect(data.result, phone).toBe('duplicate');
    }
  });

  it('blocks a different phone that reuses an email already used at this event', async () => {
    const { data } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
      p_email: EMAIL.toUpperCase(),
    });
    expect(data.result).toBe('duplicate');

    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ids.event);
    expect(count).toBe(1);
  });

  it('lets the same customer order again at a different event', async () => {
    await admin.from('events').update({ status: 'active' }).eq('slug', OTHER_EVENT_SLUG);
    await admin
      .from('event_restaurants')
      .upsert(
        { event_id: ids.otherEvent, restaurant_id: ids.restaurant },
        { onConflict: 'event_id,restaurant_id' },
      );

    const { data } = await place({ p_event_slug: OTHER_EVENT_SLUG });
    expect(data.result).toBe('created');

    const repeat = await place({ p_event_slug: OTHER_EVENT_SLUG });
    expect(repeat.data.result).toBe('duplicate');

    await admin.from('orders').delete().eq('event_id', ids.otherEvent);
    await admin.from('events').update({ status: 'inactive' }).eq('slug', OTHER_EVENT_SLUG);
  });

  it('lets only one of three simultaneous submissions win', async () => {
    await admin.from('orders').delete().eq('event_id', ids.event);

    const results = await Promise.all([
      place(),
      place({ p_menu_item_ids: [ids.expensiveItem] }),
      place(),
    ]);

    const created = results.filter((result) => result.data?.result === 'created');
    const duplicates = results.filter((result) => result.data?.result === 'duplicate');

    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(2);

    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ids.event);
    expect(count).toBe(1);
  }, 30_000);

  it('rejects a disabled restaurant', async () => {
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
      p_restaurant_id: ids.disabledRestaurant,
      p_menu_item_ids: [ids.foreignItem],
    });
    expect(error?.message).toContain('RESTAURANT_DISABLED');
  });

  it('rejects an unavailable item', async () => {
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
      p_menu_item_ids: [ids.unavailableItem],
    });
    expect(error?.message).toContain('ITEM_UNAVAILABLE');
  });

  it('rejects an item that belongs to a different restaurant', async () => {
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
      p_menu_item_ids: [ids.foreignItem],
    });
    expect(error?.message).toContain('ITEM_RESTAURANT_MISMATCH');
  });

  it('rejects an inactive event', async () => {
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
      p_event_slug: OTHER_EVENT_SLUG,
    });
    expect(error?.message).toContain('EVENT_INACTIVE');
  });

  it('rejects a caller with no anonymous session', async () => {
    const { error } = await place({ p_auth_user_id: null });
    expect(error?.message).toContain('NOT_AUTHENTICATED');
  });

  it('rejects a non-Saudi phone number', async () => {
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: '+971501234567',
    });
    expect(error?.message).toContain('INVALID_PHONE');
  });

  it('keeps existing orders after the restaurant is disabled', async () => {
    const before = await admin
      .from('orders')
      .select('id, status')
      .eq('restaurant_id', ids.restaurant);

    await admin.from('restaurants').update({ status: 'disabled' }).eq('id', ids.restaurant);

    const after = await admin
      .from('orders')
      .select('id, status')
      .eq('restaurant_id', ids.restaurant);

    expect(after.data).toEqual(before.data);

    // ...but new orders are refused.
    const { error } = await place({
      p_auth_user_id: ids.secondAuthUser,
      p_phone: SECOND_PHONE,
    });
    expect(error?.message).toContain('RESTAURANT_DISABLED');

    await admin.from('restaurants').update({ status: 'active' }).eq('id', ids.restaurant);
  });

  it('records status history for every order', async () => {
    const { data: order } = await admin
      .from('orders')
      .select('id')
      .eq('event_id', ids.event)
      .limit(1)
      .single();

    const { data: history } = await admin
      .from('order_status_history')
      .select('*')
      .eq('order_id', order!.id);

    expect(history?.length).toBeGreaterThanOrEqual(1);
    expect(history?.[0].to_status).toBe('new');
  });

  it('raises a notification for every new order', async () => {
    const { data: order } = await admin
      .from('orders')
      .select('id, order_number')
      .eq('event_id', ids.event)
      .limit(1)
      .single();

    const { data: notifications } = await admin
      .from('notifications')
      .select('*')
      .eq('order_id', order!.id)
      .eq('type', 'order.created');

    expect(notifications?.length).toBe(1);
    expect(notifications?.[0].title).toContain(order!.order_number);
  });
});

describeLive('row level security', () => {
  const anon = publicKey
    ? createClient(url!, publicKey, { auth: { persistSession: false } })
    : null;

  it('lets anonymous visitors read the public catalogue', async () => {
    if (!anon) return;
    const { error } = await anon.from('restaurants').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('never exposes customer records to an anonymous visitor', async () => {
    if (!anon) return;
    const { data } = await anon.from('customers').select('*');
    expect(data ?? []).toHaveLength(0);
  });

  it('never exposes orders to an anonymous visitor', async () => {
    if (!anon) return;
    const { data } = await anon.from('orders').select('*');
    expect(data ?? []).toHaveLength(0);
  });

  it('refuses anonymous writes to orders', async () => {
    if (!anon) return;

    const { error } = await anon.from('orders').insert({
      order_number: 'HACK-1',
      event_id: '00000000-0000-4000-8000-000000000000',
      customer_id: '00000000-0000-4000-8000-000000000000',
      restaurant_id: '00000000-0000-4000-8000-000000000000',
      menu_item_id: '00000000-0000-4000-8000-000000000000',
      unit_price: 1,
      item_name_en: 'x',
      item_name_ar: 'x',
    });
    expect(error).not.toBeNull();
  });

  it('does not let an anonymous visitor call place_order directly', async () => {
    if (!anon) return;
    const { error } = await anon.rpc('place_order', {
      p_auth_user_id: '00000000-0000-4000-8000-000000000000',
      p_phone: PHONE,
      p_event_slug: EVENT_SLUG,
      p_restaurant_id: '00000000-0000-4000-8000-000000000000',
      p_menu_item_ids: ['00000000-0000-4000-8000-000000000000'],
      p_name: 'Attacker',
      p_email: 'a@b.com',
      p_device_id: null,
    });
    expect(error).not.toBeNull();
  });

  it('reports no admin role for an anonymous session', async () => {
    if (!anon) return;
    const { data } = await anon.rpc('is_admin', {
      p_user_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(data).toBe(false);
  });
});
