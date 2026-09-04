import 'server-only';

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Secret material for phone verification.
 *
 * Two different secrets are in play:
 *   - the one-time code, which travels through WhatsApp and is stored only as an
 *     HMAC, so a database dump cannot be brute-forced back into live codes;
 *   - the session token, which is 256 bits of randomness handed to the browser
 *     in an httpOnly cookie and stored as a plain SHA-256 digest.
 */

/** No O/0/I/1: the code is read off a screen and typed into WhatsApp. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const DEV_FALLBACK_SECRET = 'development-only-phone-verification-secret';
let warnedAboutSecret = false;

/**
 * HMAC key for verification codes. Required in production; development falls
 * back to a fixed string so the flow can be exercised without configuration.
 */
export function verificationSecret(): string {
  const secret = process.env.PHONE_VERIFICATION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PHONE_VERIFICATION_SECRET is not set. Generate one with `openssl rand -base64 32`.',
    );
  }

  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn(
      '[verification] PHONE_VERIFICATION_SECRET is not set — using the development fallback. ' +
        'Set it before deploying.',
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** A cryptographically secure one-time code, e.g. "K4M7QX". */
export function generateVerificationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Uppercases and strips separators so "k4m 7qx" matches "K4M7QX". */
export function normalizeVerificationCode(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return null;
  return cleaned;
}

/** The only representation of a code that is ever persisted. */
export function hashVerificationCode(code: string): string {
  return createHmac('sha256', verificationSecret()).update(code.toUpperCase()).digest('hex');
}

/** Opaque browser session token. Never derived from anything guessable. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for signatures and digests of equal length. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
