'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { hasServiceRoleKey } from '@/lib/supabase/env';
import { normalizeSaudiPhone } from '@/lib/phone';
import { sendOtpSchema, verifyOtpSchema, placeOrderSchema } from '@/lib/validation/schemas';
import { mapAuthError, mapDatabaseError, type OrderErrorCode } from './errors';
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
 * In-process guard against hammering the resend button. Supabase Auth enforces
 * the real rate limit; this only keeps obvious repeats from leaving the server.
 */
const RESEND_COOLDOWN_MS = 30_000;
const lastSentAt = new Map<string, number>();

function throttled(phone: string): boolean {
  const previous = lastSentAt.get(phone);
  const now = Date.now();
  if (previous && now - previous < RESEND_COOLDOWN_MS) return true;
  lastSentAt.set(phone, now);
  if (lastSentAt.size > 5000) lastSentAt.clear();
  return false;
}

// ---------------------------------------------------------------------------

/**
 * Step 1 — send the 6-digit code.
 *
 * Supabase Auth delivers it through the configured Twilio SMS provider. No
 * customer row and no order exists at this point; nothing is written until the
 * number is actually verified.
 */
export async function sendVerificationCode(input: {
  name: string;
  email: string;
  phone: string;
}): Promise<ActionResult<{ phone: string }>> {
  const parsed = sendOtpSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssueCode(parsed.error.issues));

  const { phone } = parsed.data;
  if (throttled(phone)) return fail('otp_rate_limited');

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { channel: 'sms' },
  });

  if (error) {
    lastSentAt.delete(phone);
    return fail(mapAuthError(error.message, error.status));
  }

  return { ok: true, data: { phone } };
}

/**
 * Step 2 — verify the code and place the order in one round trip.
 *
 * Everything that matters is decided server-side: the phone comes from the
 * freshly verified session (never from the form), and `place_order` re-reads the
 * event, restaurant, item and price from the database inside one transaction.
 */
export async function verifyAndPlaceOrder(input: {
  phone: string;
  code: string;
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  email: string;
}): Promise<ActionResult<{ result: 'created' | 'duplicate'; order: OrderPayload }>> {
  const otpParsed = verifyOtpSchema.safeParse({ phone: input.phone, code: input.code });
  if (!otpParsed.success) return fail(firstIssueCode(otpParsed.error.issues));

  const orderParsed = placeOrderSchema.safeParse({
    eventSlug: input.eventSlug,
    restaurantId: input.restaurantId,
    menuItemId: input.menuItemId,
    name: input.name,
    email: input.email,
  });
  if (!orderParsed.success) return fail(firstIssueCode(orderParsed.error.issues));

  if (!hasServiceRoleKey()) return fail('unknown');

  const supabase = await createServerSupabase();
  const { data: session, error: verifyError } = await supabase.auth.verifyOtp({
    phone: otpParsed.data.phone,
    token: otpParsed.data.code,
    type: 'sms',
  });

  if (verifyError) return fail(mapAuthError(verifyError.message, verifyError.status));

  const user = session.user;
  if (!user) return fail('not_verified');

  // Trust the session's phone, not the submitted one.
  const verifiedPhone = normalizeSaudiPhone(user.phone ?? otpParsed.data.phone);
  if (!verifiedPhone) return fail('phone_invalid');

  return placeOrderForUser({
    authUserId: user.id,
    phone: verifiedPhone,
    ...orderParsed.data,
  });
}

/**
 * Step 3 — create the order for an already verified session.
 *
 * Also used when a guest returns with a live session (e.g. after a refresh)
 * so the flow can finish without asking for another code.
 */
export async function placeOrderForVerifiedSession(input: {
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  email: string;
}): Promise<ActionResult<{ result: 'created' | 'duplicate'; order: OrderPayload }>> {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssueCode(parsed.error.issues));

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.phone) return fail('not_verified');

  const phone = normalizeSaudiPhone(user.phone);
  if (!phone) return fail('phone_invalid');

  return placeOrderForUser({ authUserId: user.id, phone, ...parsed.data });
}

async function placeOrderForUser({
  authUserId,
  phone,
  eventSlug,
  restaurantId,
  menuItemId,
  name,
  email,
}: {
  authUserId: string;
  phone: string;
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  email: string;
}): Promise<ActionResult<{ result: 'created' | 'duplicate'; order: OrderPayload }>> {
  if (!hasServiceRoleKey()) return fail('unknown');

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('place_order', {
    p_auth_user_id: authUserId,
    p_phone: phone,
    p_event_slug: eventSlug,
    p_restaurant_id: restaurantId,
    p_menu_item_id: menuItemId,
    p_name: name,
    p_email: email,
  });

  if (error) return fail(mapDatabaseError(error.message));

  const payload = data as unknown as PlaceOrderResult | null;
  if (!payload?.order) return fail('unknown');

  return { ok: true, data: { result: payload.result, order: payload.order } };
}
