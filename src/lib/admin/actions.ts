'use server';

import { revalidatePath } from 'next/cache';
import { getAdminContext, auditLog } from '@/lib/auth/admin';
import {
  categoryFormSchema,
  eventFormSchema,
  menuItemFormSchema,
  restaurantFormSchema,
  updateOrderStatusSchema,
} from '@/lib/validation/schemas';
import { canTransition } from './transitions';
import type { OrderStatus } from '@/types/database';

export type AdminResult = { ok: true; id?: string } | { ok: false; error: string };

const DENIED: AdminResult = { ok: false, error: 'You are not authorized to do that.' };

function fail(error: string): AdminResult {
  return { ok: false, error };
}

/** Turns a Zod issue list into one readable sentence. */
function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${String(issue.path[0] ?? 'field')}: ${issue.message}`)
    .join(' · ');
}

// ------------------------------------------------------------------- orders

export async function updateOrderStatus(input: {
  orderId: string;
  status: OrderStatus;
  reason?: string | null;
}): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const parsed = updateOrderStatusSchema.safeParse(input);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues));

  const { supabase, user } = context;
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, order_number')
    .eq('id', parsed.data.orderId)
    .maybeSingle();

  if (!order) return fail('Order not found.');

  if (!canTransition(order.status, parsed.data.status)) {
    return fail(`Cannot move an order from ${order.status} to ${parsed.data.status}.`);
  }

  const { error } = await supabase
    .from('orders')
    .update({
      status: parsed.data.status,
      cancel_reason: parsed.data.status === 'cancelled' ? (parsed.data.reason ?? null) : null,
    })
    .eq('id', order.id)
    // Optimistic concurrency: a second click that lost the race changes nothing.
    .eq('status', order.status);

  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'order.status', 'orders', order.id, {
    from: order.status,
    to: parsed.data.status,
  });

  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath('/admin/dashboard');
  return { ok: true, id: order.id };
}

// -------------------------------------------------------------- restaurants

export async function saveRestaurant(input: unknown): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const parsed = restaurantFormSchema.safeParse(input);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues));

  const { supabase, user } = context;
  const { id, event_ids: eventIds, ...fields } = parsed.data;
  const payload = {
    ...fields,
    logo_url: fields.logo_url || null,
    cover_image_url: fields.cover_image_url || null,
  };

  const { data, error } = id
    ? await supabase.from('restaurants').update(payload).eq('id', id).select('id').maybeSingle()
    : await supabase.from('restaurants').insert(payload).select('id').maybeSingle();

  if (error) {
    return fail(
      error.code === '23505' ? 'Another restaurant already uses that slug.' : error.message,
    );
  }
  const restaurantId = data?.id ?? id;
  if (!restaurantId) return fail('Could not save the restaurant.');

  // Re-link the restaurant to exactly the chosen events.
  await supabase.from('event_restaurants').delete().eq('restaurant_id', restaurantId);
  if (eventIds.length > 0) {
    await supabase.from('event_restaurants').insert(
      eventIds.map((eventId) => ({
        event_id: eventId,
        restaurant_id: restaurantId,
        display_order: fields.display_order,
      })),
    );
  }

  await auditLog(
    supabase,
    user.id,
    id ? 'restaurant.update' : 'restaurant.create',
    'restaurants',
    restaurantId,
  );

  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/menu');
  return { ok: true, id: restaurantId };
}

export async function setRestaurantStatus(
  id: string,
  status: 'active' | 'disabled',
): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { error } = await supabase.from('restaurants').update({ status }).eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'restaurant.status', 'restaurants', id, { status });

  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/dashboard');
  return { ok: true, id };
}

export async function deleteRestaurant(id: string): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', id);

  if ((count ?? 0) > 0) {
    return fail(
      `This restaurant has ${count} order(s) in history and cannot be deleted. Disable it instead.`,
    );
  }

  const { error } = await supabase.from('restaurants').delete().eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'restaurant.delete', 'restaurants', id);
  revalidatePath('/admin/restaurants');
  return { ok: true };
}

// ---------------------------------------------------------------- menu

export async function saveCategory(input: unknown): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const parsed = categoryFormSchema.safeParse(input);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues));

  const { supabase, user } = context;
  const { id, ...fields } = parsed.data;

  const { data, error } = id
    ? await supabase.from('menu_categories').update(fields).eq('id', id).select('id').maybeSingle()
    : await supabase.from('menu_categories').insert(fields).select('id').maybeSingle();

  if (error) return fail(error.message);

  await auditLog(
    supabase,
    user.id,
    id ? 'category.update' : 'category.create',
    'menu_categories',
    data?.id ?? id ?? null,
  );
  revalidatePath('/admin/menu');
  return { ok: true, id: data?.id ?? id };
}

export async function deleteCategory(id: string): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { count } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if ((count ?? 0) > 0) {
    return fail(`Move or delete the ${count} item(s) in this category first.`);
  }

  const { error } = await supabase.from('menu_categories').delete().eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'category.delete', 'menu_categories', id);
  revalidatePath('/admin/menu');
  return { ok: true };
}

export async function saveMenuItem(input: unknown): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const parsed = menuItemFormSchema.safeParse(input);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues));

  const { supabase, user } = context;
  const { id, ...fields } = parsed.data;
  const payload = { ...fields, image_url: fields.image_url || null };

  const { data, error } = id
    ? await supabase.from('menu_items').update(payload).eq('id', id).select('id').maybeSingle()
    : await supabase.from('menu_items').insert(payload).select('id').maybeSingle();

  if (error) return fail(error.message);

  await auditLog(
    supabase,
    user.id,
    id ? 'item.update' : 'item.create',
    'menu_items',
    data?.id ?? id ?? null,
  );
  revalidatePath('/admin/menu');
  return { ok: true, id: data?.id ?? id };
}

export async function setMenuItemAvailability(
  id: string,
  isAvailable: boolean,
): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'item.availability', 'menu_items', id, { isAvailable });
  revalidatePath('/admin/menu');
  return { ok: true, id };
}

export async function deleteMenuItem(id: string): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('menu_item_id', id);

  if ((count ?? 0) > 0) {
    return fail(
      `This item appears on ${count} order(s) and cannot be deleted. Mark it unavailable instead.`,
    );
  }

  const { error } = await supabase.from('menu_items').delete().eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'item.delete', 'menu_items', id);
  revalidatePath('/admin/menu');
  return { ok: true };
}

// --------------------------------------------------------------- events

export async function saveEvent(input: unknown): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues));

  const { supabase, user } = context;
  const { id, ...fields } = parsed.data;
  const payload = {
    ...fields,
    logo_url: fields.logo_url || null,
    hero_image_url: fields.hero_image_url || null,
    start_date: fields.start_date || null,
    end_date: fields.end_date || null,
  };

  const { data, error } = id
    ? await supabase.from('events').update(payload).eq('id', id).select('id').maybeSingle()
    : await supabase.from('events').insert(payload).select('id').maybeSingle();

  if (error) {
    return fail(error.code === '23505' ? 'Another event already uses that slug.' : error.message);
  }

  await auditLog(
    supabase,
    user.id,
    id ? 'event.update' : 'event.create',
    'events',
    data?.id ?? id ?? null,
  );
  revalidatePath('/admin/events');
  revalidatePath('/admin/dashboard');
  return { ok: true, id: data?.id ?? id };
}

export async function setEventStatus(
  id: string,
  status: 'draft' | 'active' | 'inactive',
): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;

  // Only one event runs at a time, so activating one stands the others down.
  if (status === 'active') {
    await supabase
      .from('events')
      .update({ status: 'inactive' })
      .eq('status', 'active')
      .neq('id', id);
  }

  const { error } = await supabase.from('events').update({ status }).eq('id', id);
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'event.status', 'events', id, { status });
  revalidatePath('/admin/events');
  revalidatePath('/admin/dashboard');
  return { ok: true, id };
}

// -------------------------------------------------------- notifications

export async function markNotificationRead(id: string): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { error } = await context.supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);
  if (error) return fail(error.message);

  revalidatePath('/admin/notifications');
  return { ok: true, id };
}

export async function markAllNotificationsRead(): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { error } = await context.supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false);
  if (error) return fail(error.message);

  revalidatePath('/admin/notifications');
  return { ok: true };
}

// ------------------------------------------------------------- settings

export async function saveSettings(input: { sound_notifications: boolean }): Promise<AdminResult> {
  const context = await getAdminContext();
  if (!context) return DENIED;

  const { supabase, user } = context;
  const { data: existing } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'general')
    .maybeSingle();

  const value = {
    ...((existing?.value as Record<string, unknown> | null) ?? {}),
    sound_notifications: Boolean(input.sound_notifications),
  };

  const { error } = await supabase.from('app_settings').upsert({ key: 'general', value });
  if (error) return fail(error.message);

  await auditLog(supabase, user.id, 'settings.update', 'app_settings', 'general', value);
  revalidatePath('/admin/settings');
  return { ok: true };
}
