'use server';

import { startVerificationSchema } from '@/lib/validation/schemas';
import type { OrderErrorCode } from '@/lib/orders/errors';
import type { OrderPayload } from '@/types/database';
import {
  createVerificationRequest,
  forgetVerification,
  getVerificationState,
  type ServiceResult,
  type VerificationRequestResult,
} from './service';

/**
 * Server actions for the verification screen.
 *
 * None of these accept a verification id, a phone number or a status from the
 * browser as an authority: the only thing the browser holds is an opaque
 * httpOnly cookie, and every answer is read from the database behind it.
 */

function fail(error: OrderErrorCode): { ok: false; error: OrderErrorCode } {
  return { ok: false, error };
}

/** Step 1 — the attendee gives a name and a number. */
export async function startPhoneVerification(input: {
  eventSlug: string;
  name: string;
  phone: string;
}): Promise<ServiceResult<VerificationRequestResult>> {
  const parsed = startVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return fail((parsed.error.issues[0]?.message ?? 'unknown') as OrderErrorCode);
  }

  return createVerificationRequest(parsed.data);
}

export interface VerificationStatusView {
  status: 'none' | 'pending' | 'verified' | 'expired' | 'failed';
  phone?: string;
  name?: string;
  expiresAt?: string;
  eventSlug?: string;
  order?: OrderPayload | null;
}

/** Step 2 — polled by the verification screen while the guest is in WhatsApp. */
export async function checkVerificationStatus(): Promise<VerificationStatusView> {
  const state = await getVerificationState();

  return {
    status: state.status,
    phone: state.phone,
    name: state.name,
    expiresAt: state.expires_at,
    eventSlug: state.event?.slug,
    order: state.order ?? null,
  };
}

/** Drops the browser's handle on its verification (the row is left intact). */
export async function endVerificationSession(): Promise<void> {
  await forgetVerification();
}
