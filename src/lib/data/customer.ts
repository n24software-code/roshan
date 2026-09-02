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

/** A single item together with its restaurant, used by the selection screen. */
export async function getSelection(
  eventId: string,
  menuItemId: string,
): Promise<{ item: MenuItemRow; restaurant: RestaurantRow } | null> {
  const supabase = await createServerSupabase();

  const { data: item } = await supabase
    .from('menu_items')
    .select('*')
    .eq('id', menuItemId)
    .maybeSingle();
  if (!item) return null;

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*, event_restaurants!inner(event_id)')
    .eq('id', item.restaurant_id)
    .eq('event_restaurants.event_id', eventId)
    .maybeSingle();
  if (!restaurant) return null;

  return { item, restaurant: restaurant as RestaurantRow };
}
