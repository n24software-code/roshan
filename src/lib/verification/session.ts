import 'server-only';

import { cookies } from 'next/headers';

/**
 * The browser's handle on its verification.
 *
 * This cookie is a lookup key and nothing else: it carries no phone number, no
 * status and no signature to trust. Every decision is made from the
 * phone_verifications row it resolves to, so clearing, copying or forging the
 * cookie cannot produce a verified state that the database does not already hold.
 */

export const VERIFICATION_COOKIE = 'roshn_verification';

/** Matches the verified-session lifetime enforced in the database. */
export const VERIFIED_SESSION_TTL_SECONDS = 6 * 60 * 60;

export async function readVerificationToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(VERIFICATION_COOKIE)?.value?.trim();
  return value ? value : null;
}

/** Only callable from a server action or a route handler. */
export async function writeVerificationToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(VERIFICATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VERIFIED_SESSION_TTL_SECONDS,
  });
}

export async function clearVerificationToken(): Promise<void> {
  const store = await cookies();
  store.delete(VERIFICATION_COOKIE);
}
