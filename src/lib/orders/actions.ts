'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { hasServiceRoleKey } from '@/lib/supabase/env';
import { placeOrderSchema } from '@/lib/validation/schemas';
import { mapDatabaseError, type OrderErrorCode } from './errors';
import type { OrderPayload, PlaceOrderResult } from '@/types/database';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: OrderErrorCode };

function fail(error: OrderErrorCode): { ok: false; error: OrderErrorCode } {
  return { ok: false, error };
}

/** First validation issue, expressed as one of our shared error codes. */
function firstIssueCode(issues: { message: string }[]): OrderErrorCode {
  return (issues[0]?.message ?? 'unknown') as OrderErrorCode;
}

/**
 * The one and only order-creation entry point.
 *
 * No code, no SMS, no verification: the guest gives their name, email and
 * phone and the order is placed. Everything that matters is decided
 * server-side — `place_order` normalizes the phone and email, re-reads the
 * event, restaurant, item and price from the database, and the unique indexes
 * on (event_id, normalized_phone) and (event_id, normalized_email) are what
 * actually make a second order impossible.
 */
export async function placeOrder(input: {
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  email: string;
  phone: string;
  deviceId?: string | null;
}): Promise<ActionResult<{ result: 'created' | 'duplicate'; order: OrderPayload }>> {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssueCode(parsed.error.issues));

  if (!hasServiceRoleKey()) return fail('order_failed');

  const authUserId = await currentOrNewAnonymousUserId();
  if (!authUserId) return fail('not_authenticated');

  const { eventSlug, restaurantId, menuItemId, name, email, phone, deviceId } = parsed.data;

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('place_order', {
    p_auth_user_id: authUserId,
    p_phone: phone,
    p_event_slug: eventSlug,
    p_restaurant_id: restaurantId,
    p_menu_item_id: menuItemId,
    p_name: name,
    p_email: email,
    p_device_id: deviceId ?? null,
  });

  if (error) return fail(mapDatabaseError(error.message));

  const payload = data as unknown as PlaceOrderResult | null;
  if (!payload?.order) return fail('order_failed');

  return { ok: true, data: { result: payload.result, order: payload.order } };
}

/**
 * The guest's anonymous Supabase user. The browser normally creates it when
 * the event page opens; this is the fallback for the case where it did not
 * (storage blocked, session expired between page load and submit).
 */
async function currentOrNewAnonymousUserId(): Promise<string | null> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Without this the guest only ever sees "We could not start your session"
    // and the operator has nothing to go on. The most common cause by far is
    // `anonymous_provider_disabled`: Supabase dashboard -> Authentication ->
    // Sign In / Providers -> Anonymous sign-ins.
    console.error(
      `[placeOrder] anonymous sign-in failed: ${error.code ?? error.status ?? 'unknown'} — ${error.message}`,
    );
    return null;
  }
  return data.user?.id ?? null;
}
