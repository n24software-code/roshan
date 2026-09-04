import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { hasServiceRoleKey } from '@/lib/supabase/env';
import { normalizeSaudiPhone } from '@/lib/phone';
import { mapDatabaseError, type OrderErrorCode } from '@/lib/orders/errors';
import type {
  ConfirmVerificationResult,
  RequestVerificationResult,
  VerificationSessionState,
} from '@/types/database';
import {
  generateSessionToken,
  generateVerificationCode,
  hashSessionToken,
  hashVerificationCode,
  normalizeVerificationCode,
} from './codes';
import { buildVerificationMessage, extractVerificationCode } from './message';
import { getVerificationProvider } from './providers';
import type { IncomingMessage } from './providers/types';
import {
  VERIFIED_SESSION_TTL_SECONDS,
  clearVerificationToken,
  readVerificationToken,
  writeVerificationToken,
} from './session';

/**
 * Phone verification service.
 *
 * The provider decides how a message reaches us; this module decides what a
 * message means. Every state change goes through a database function, so the
 * source of truth for "is this number verified" is always a row, never a cookie
 * and never a client-supplied flag.
 */

/** How long a code stays usable. */
const CODE_TTL_SECONDS = 600;
/** Seconds a guest must wait before asking for another code. */
export const RESEND_COOLDOWN_SECONDS = 30;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: OrderErrorCode };

function fail(error: OrderErrorCode): { ok: false; error: OrderErrorCode } {
  return { ok: false, error };
}

export interface VerificationRequestView {
  result: 'created';
  phone: string;
  name: string;
  expiresAt: string;
  /** Deep link that opens WhatsApp with the message prefilled. */
  whatsappUrl: string | null;
  /** Present only under the development provider, for the simulate shortcut. */
  developmentMessage?: { from: string; text: string };
}

export type VerificationRequestResult = VerificationRequestView;

/**
 * Creates a verification request and hands the browser its session cookie.
 *
 * The code and the session token are generated here and leave the server only
 * in the WhatsApp message and the httpOnly cookie respectively; the database
 * receives hashes.
 *
 * A number that has already ordered is still allowed to verify — that is how a
 * guest who cleared their cookies gets back to their order number — and nothing
 * about that order is revealed until the number has been proven.
 */
export async function createVerificationRequest(input: {
  eventSlug: string;
  name: string;
  phone: string;
}): Promise<ServiceResult<VerificationRequestResult>> {
  if (!hasServiceRoleKey()) return fail('unknown');

  let provider;
  try {
    provider = getVerificationProvider();
  } catch (error) {
    console.error('[verification] provider unavailable:', error);
    return fail('verification_not_configured');
  }

  if (!provider.isConfigured()) return fail('verification_not_configured');

  const code = generateVerificationCode();
  const token = generateSessionToken();

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('request_phone_verification', {
    p_event_slug: input.eventSlug,
    p_phone: input.phone,
    p_name: input.name,
    p_code_hash: hashVerificationCode(code),
    p_token_hash: hashSessionToken(token),
    p_code_ttl_seconds: CODE_TTL_SECONDS,
    p_provider: provider.id,
    p_resend_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
    p_max_per_hour: MAX_REQUESTS_PER_HOUR,
  });

  if (error) return fail(mapDatabaseError(error.message));

  const payload = data as unknown as RequestVerificationResult | null;
  if (!payload) return fail('unknown');

  await writeVerificationToken(token);

  const message = buildVerificationMessage({ code, phone: payload.phone });

  return {
    ok: true,
    data: {
      result: 'created',
      phone: payload.phone,
      name: payload.name,
      expiresAt: payload.expires_at,
      whatsappUrl: provider.buildHandoffUrl(message),
      ...(provider.isDevelopment
        ? { developmentMessage: { from: payload.phone, text: message } }
        : {}),
    },
  };
}

/** The authoritative state behind the caller's verification cookie. */
export async function getVerificationState(): Promise<VerificationSessionState> {
  const token = await readVerificationToken();
  if (!token || !hasServiceRoleKey()) return { status: 'none' };

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('verification_session', {
    p_token_hash: hashSessionToken(token),
  });

  if (error) {
    console.error('[verification] session lookup failed:', error.message);
    return { status: 'none' };
  }

  return (data as unknown as VerificationSessionState | null) ?? { status: 'none' };
}

export async function forgetVerification(): Promise<void> {
  await clearVerificationToken();
}

/**
 * Consumes one inbound message.
 *
 * Ownership of the number is established by the *sender* reported by the
 * provider. The code in the body only says which request is being answered.
 */
export async function verifyIncomingMessage(
  message: IncomingMessage,
): Promise<'verified' | 'no_match' | 'ignored'> {
  if (!hasServiceRoleKey()) return 'ignored';

  const phone = normalizeSaudiPhone(message.from);
  if (!phone) return 'ignored';

  const extracted = extractVerificationCode(message.text ?? '');
  const code = extracted ? normalizeVerificationCode(extracted) : null;
  if (!code) return 'ignored';

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('confirm_phone_verification', {
    p_phone: phone,
    p_code_hash: hashVerificationCode(code),
    p_provider: getVerificationProvider().id,
    p_max_attempts: MAX_ATTEMPTS,
    p_session_ttl_seconds: VERIFIED_SESSION_TTL_SECONDS,
  });

  if (error) {
    console.error('[verification] confirm failed:', error.message);
    return 'no_match';
  }

  const payload = data as unknown as ConfirmVerificationResult | null;
  return payload?.result === 'verified' ? 'verified' : 'no_match';
}
