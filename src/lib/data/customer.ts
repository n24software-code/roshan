import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { EventRow, MenuCategoryRow, MenuItemRow, RestaurantRow } from '@/types/database';

/**
 * Read helpers for the storefront. All of these run under RLS with the public
 * key, so they can only ever see the public catalogue.
 */

/** The event currently running. Only one event is active at a time. */
export async function getActiveEvent(): Promise<EventRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'active')
    .order('start_date', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle();
  return data ?? null;
}

/** Restaurants taking part in an event, disabled ones included. */
export async function getEventRestaurants(eventId: string): Promise<RestaurantRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('event_restaurants')
    .select('display_order, restaurants(*)')
    .eq('event_id', eventId)
    .order('display_order', { ascending: true });

  type Joined = { display_order: number; restaurants: RestaurantRow | null };
  return ((data ?? []) as unknown as Joined[])
    .map((row) => row.restaurants)
    .filter((r): r is RestaurantRow => Boolean(r))
    .sort((a, b) => a.display_order - b.display_order || a.name_en.localeCompare(b.name_en));
}

export async function getRestaurantBySlug(
  eventId: string,
  slug: string,
): Promise<RestaurantRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('restaurants')
    .select('*, event_restaurants!inner(event_id)')
    .eq('slug', slug)
    .eq('event_restaurants.event_id', eventId)
    .maybeSingle();
  return (data as RestaurantRow | null) ?? null;
}

export async function getRestaurantMenu(restaurantId: string): Promise<{
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
}> {
  const supabase = await createServerSupabase();
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

  return { categories: categories.data ?? [], items: items.data ?? [] };
}

/**
 * The chosen items together with their restaurant and categories, used by the
 * selection screen.
 *
 * Re-read from the database rather than trusted from the link: the items must
 * all exist, share one restaurant that takes part in this event, and hold at
 * most one slot per category. Anything else resolves to null and the guest is
 * sent back to browsing. `place_order` repeats every one of these checks.
 */
export async function getSelection(
  eventId: string,
  menuItemIds: string[],
): Promise<{
  restaurant: RestaurantRow;
  entries: { item: MenuItemRow; category: MenuCategoryRow | null }[];
  total: number;
} | null> {
  const unique = [...new Set(menuItemIds.filter(Boolean))];
  if (unique.length === 0) return null;

  const supabase = await createServerSupabase();

  const { data: items } = await supabase.from('menu_items').select('*').in('id', unique);
  if (!items || items.length !== unique.length) return null;

  // Every item must come from the same restaurant.
  const restaurantIds = new Set(items.map((item) => item.restaurant_id));
  if (restaurantIds.size !== 1) return null;

  // ...and hold at most one slot per category (null counts as a single slot).
  const categoryKeys = items.map((item) => item.category_id ?? 'uncategorised');
  if (new Set(categoryKeys).size !== categoryKeys.length) return null;

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*, event_restaurants!inner(event_id)')
    .eq('id', items[0].restaurant_id)
    .eq('event_restaurants.event_id', eventId)
    .maybeSingle();
  if (!restaurant) return null;

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*')
    .eq('restaurant_id', items[0].restaurant_id)
    .order('display_order', { ascending: true });

  const byId = new Map((categories ?? []).map((category) => [category.id, category]));
  const order = new Map((categories ?? []).map((category, index) => [category.id, index]));

  const entries = items
    .map((item) => ({ item, category: byId.get(item.category_id ?? '') ?? null }))
    .sort(
      (a, b) =>
        (order.get(a.item.category_id ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.item.category_id ?? '') ?? Number.MAX_SAFE_INTEGER) ||
        a.item.display_order - b.item.display_order,
    );

  return {
    restaurant: restaurant as RestaurantRow,
    entries,
    total: items.reduce((sum, item) => sum + Number(item.price), 0),
  };
}
