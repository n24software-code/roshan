'use server';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { hasServiceRoleKey } from '@/lib/supabase/env';
import { submitOrderSchema } from '@/lib/validation/schemas';
import { hashSessionToken } from '@/lib/verification/codes';
import { readVerificationToken } from '@/lib/verification/session';
import { getVerificationState } from '@/lib/verification/service';
import { mapDatabaseError, type OrderErrorCode } from './errors';
import type { OrderPayload, OrderStatus, PlaceOrderResult } from '@/types/database';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: OrderErrorCode };

function fail(error: OrderErrorCode): { ok: false; error: OrderErrorCode } {
  return { ok: false, error };
}

/**
 * The single order-submission entry point.
 *
 * The identity is not in the arguments: it comes from the verification row that
 * the caller's httpOnly cookie resolves to. `place_verified_order` re-reads the
 * event, restaurant, item and price inside one transaction, and the UNIQUE
 * constraint on (event_id, customer_phone) settles concurrent submissions — so
 * repeated clicks, a second tab, a replayed request or a direct call to this
 * action all converge on the same single order.
 */
export async function submitVerifiedOrder(input: {
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
}): Promise<ActionResult<{ result: 'created' | 'duplicate'; order: OrderPayload }>> {
  const parsed = submitOrderSchema.safeParse(input);
  if (!parsed.success) {
    return fail((parsed.error.issues[0]?.message ?? 'invalid_selection') as OrderErrorCode);
  }

  if (!hasServiceRoleKey()) return fail('unknown');

  const token = await readVerificationToken();
  if (!token) return fail('verification_required');

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('place_verified_order', {
    p_token_hash: hashSessionToken(token),
    p_event_slug: parsed.data.eventSlug,
    p_restaurant_id: parsed.data.restaurantId,
    p_menu_item_id: parsed.data.menuItemId,
  });

  if (error) return fail(mapDatabaseError(error.message));

  const payload = data as unknown as PlaceOrderResult | null;
  if (!payload?.order) return fail('unknown');

  return { ok: true, data: { result: payload.result, order: payload.order } };
}

/**
 * The order belonging to the caller's verified session, if there is one.
 * Used by the confirmation screen, which has no Supabase session to read with.
 */
export async function getMyOrder(): Promise<OrderPayload | null> {
  const state = await getVerificationState();
  return state.order ?? null;
}

/** Lightweight poll for the confirmation screen's live status. */
export async function getMyOrderStatus(): Promise<{
  status: OrderStatus;
  orderNumber: string;
} | null> {
  const order = await getMyOrder();
  return order ? { status: order.status, orderNumber: order.order_number } : null;
}
