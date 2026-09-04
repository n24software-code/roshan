import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MenuItemRow, OrderRow, OrderStatus, RestaurantRow } from '@/types/database';

type Client = SupabaseClient<Database>;

export const ORDER_STATUS_LIST: OrderStatus[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
];

/** Counts for the dashboard home, in one round trip per metric. */
export async function getDashboardStats(supabase: Client, eventId?: string) {
  const countOrders = async (status?: OrderStatus) => {
    let query = supabase.from('orders').select('id', { count: 'exact', head: true });
    if (status) query = query.eq('status', status);
    if (eventId) query = query.eq('event_id', eventId);
    const { count } = await query;
    return count ?? 0;
  };

  const [total, ...byStatus] = await Promise.all([
    countOrders(),
    ...ORDER_STATUS_LIST.map((status) => countOrders(status)),
  ]);

  const [{ count: restaurants }, { count: activeRestaurants }, { count: customers }] =
    await Promise.all([
      supabase.from('restaurants').select('id', { count: 'exact', head: true }),
      supabase
        .from('restaurants')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
    ]);

  const statuses = Object.fromEntries(
    ORDER_STATUS_LIST.map((status, index) => [status, byStatus[index]]),
  ) as Record<OrderStatus, number>;

  return {
    total,
    statuses,
    restaurants: restaurants ?? 0,
    activeRestaurants: activeRestaurants ?? 0,
    disabledRestaurants: (restaurants ?? 0) - (activeRestaurants ?? 0),
    customers: customers ?? 0,
  };
}

export type AdminOrder = OrderRow & {
  customers: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    phone_verified: boolean;
  } | null;
  restaurants: { id: string; name_en: string; slug: string } | null;
  events: { id: string; name_en: string; slug: string } | null;
};

const ORDER_SELECT =
  '*, customers(id, name, email, phone, phone_verified), restaurants(id, name_en, slug), events(id, name_en, slug)';

/** Orders list with status filter, free-text search and pagination. */
export async function getOrders(
  supabase: Client,
  options: {
    status?: OrderStatus | 'all';
    search?: string;
    eventId?: string;
    restaurantId?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(options.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from('orders')
    .select(ORDER_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);
  if (options.eventId) query = query.eq('event_id', options.eventId);
  if (options.restaurantId) query = query.eq('restaurant_id', options.restaurantId);

  const search = options.search?.trim();
  if (search) {
    // Order number and item name live on the order; customer fields are matched
    // by resolving them to ids first, since PostgREST cannot OR across joins.
    const term = `%${search}%`;
    const { data: customerMatches } = await supabase
      .from('customers')
      .select('id')
      .or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`)
      .limit(200);

    const { data: restaurantMatches } = await supabase
      .from('restaurants')
      .select('id')
      .or(`name_en.ilike.${term},name_ar.ilike.${term}`)
      .limit(200);

    const filters = [`order_number.ilike.${term}`, `item_name_en.ilike.${term}`];
    const customerIds = (customerMatches ?? []).map((row) => row.id);
    const restaurantIds = (restaurantMatches ?? []).map((row) => row.id);
    if (customerIds.length) filters.push(`customer_id.in.(${customerIds.join(',')})`);
    if (restaurantIds.length) filters.push(`restaurant_id.in.(${restaurantIds.join(',')})`);

    query = query.or(filters.join(','));
  }

  const { data, count } = await query.range(from, from + pageSize - 1);

  return {
    orders: (data ?? []) as unknown as AdminOrder[],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

export async function getOrder(supabase: Client, id: string) {
  const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  return (data as unknown as AdminOrder | null) ?? null;
}

export async function getOrderHistory(supabase: Client, orderId: string) {
  const { data } = await supabase
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function getRestaurants(supabase: Client) {
  const { data } = await supabase
    .from('restaurants')
    .select('*, event_restaurants(event_id)')
    .order('display_order', { ascending: true });
  return (data ?? []) as unknown as (RestaurantRow & {
    event_restaurants: { event_id: string }[];
  })[];
}

export async function getRestaurant(supabase: Client, id: string) {
  const { data } = await supabase
    .from('restaurants')
    .select('*, event_restaurants(event_id)')
    .eq('id', id)
    .maybeSingle();
  return (
    (data as unknown as (RestaurantRow & { event_restaurants: { event_id: string }[] }) | null) ??
    null
  );
}

export async function getMenu(supabase: Client, restaurantId: string) {
  const [categories, items] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order', { ascending: true }),
  ]);
  return { categories: categories.data ?? [], items: (items.data ?? []) as MenuItemRow[] };
}

export async function getEvents(supabase: Client) {
  const { data } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}

export type AdminCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  phone_verified: boolean;
  created_at: string;
  orders: { id: string; order_number: string; status: OrderStatus; event_id: string }[];
};

export async function getCustomers(
  supabase: Client,
  options: { search?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(options.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from('customers')
    .select(
      'id, name, email, phone, phone_verified, created_at, orders(id, order_number, status, event_id)',
      {
        count: 'exact',
      },
    )
    .order('created_at', { ascending: false });

  const search = options.search?.trim();
  if (search) {
    const term = `%${search}%`;
    query = query.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }

  const { data, count } = await query.range(from, from + pageSize - 1);

  return {
    customers: (data ?? []) as unknown as AdminCustomer[],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/**
 * Duplicate order attempts per customer, so staff can see when a guest tried to
 * order a second time. The one-order rule blocked every one of these.
 */
export async function getDuplicateAttempts(
  supabase: Client,
  customerIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;

  const { data } = await supabase
    .from('admin_audit_logs')
    .select('meta')
    .eq('action', 'order.duplicate_attempt')
    .limit(2000);

  const wanted = new Set(customerIds);
  for (const row of data ?? []) {
    const customerId = (row.meta as { customer_id?: string } | null)?.customer_id;
    if (customerId && wanted.has(customerId)) {
      counts.set(customerId, (counts.get(customerId) ?? 0) + 1);
    }
  }
  return counts;
}

export async function getNotifications(supabase: Client, limit = 50) {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Aggregates for the reports page. Computed from order rows, not payments. */
export async function getReport(supabase: Client, eventId?: string) {
  let query = supabase
    .from('orders')
    .select('id, status, unit_price, item_name_en, restaurant_id, customer_id, created_at');
  if (eventId) query = query.eq('event_id', eventId);

  const { data } = await query;
  const orders = data ?? [];

  const restaurantsResult = await supabase.from('restaurants').select('id, name_en');
  const restaurantNames = new Map(
    (restaurantsResult.data ?? []).map((row) => [row.id, row.name_en]),
  );

  const byStatus = Object.fromEntries(ORDER_STATUS_LIST.map((status) => [status, 0])) as Record<
    OrderStatus,
    number
  >;

  const byRestaurant = new Map<string, { name: string; orders: number; value: number }>();
  const byItem = new Map<string, { name: string; orders: number; value: number }>();
  const customers = new Set<string>();

  let totalValue = 0;

  for (const order of orders) {
    byStatus[order.status as OrderStatus] += 1;
    customers.add(order.customer_id);

    const price = Number(order.unit_price);
    // Cancelled orders stay in history but do not count towards order value.
    if (order.status !== 'cancelled') totalValue += price;

    const restaurantName = restaurantNames.get(order.restaurant_id) ?? 'Unknown';
    const restaurantEntry = byRestaurant.get(order.restaurant_id) ?? {
      name: restaurantName,
      orders: 0,
      value: 0,
    };
    restaurantEntry.orders += 1;
    if (order.status !== 'cancelled') restaurantEntry.value += price;
    byRestaurant.set(order.restaurant_id, restaurantEntry);

    const itemEntry = byItem.get(order.item_name_en) ?? {
      name: order.item_name_en,
      orders: 0,
      value: 0,
    };
    itemEntry.orders += 1;
    if (order.status !== 'cancelled') itemEntry.value += price;
    byItem.set(order.item_name_en, itemEntry);
  }

  const sortByOrders = <T extends { orders: number }>(entries: T[]) =>
    [...entries].sort((a, b) => b.orders - a.orders);

  return {
    totalOrders: orders.length,
    byStatus,
    uniqueCustomers: customers.size,
    estimatedOrderValue: totalValue,
    byRestaurant: sortByOrders([...byRestaurant.values()]),
    byItem: sortByOrders([...byItem.values()]),
  };
}

export async function getSettings(supabase: Client) {
  const { data } = await supabase
    .from('app_settings')
    .select('*')
    .eq('key', 'general')
    .maybeSingle();
  return (data?.value ?? {}) as { active_event_slug?: string; sound_notifications?: boolean };
}
