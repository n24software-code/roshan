/**
 * Central email handling.
 *
 * Every email passes through `normalizeEmail` before it is stored or compared,
 * so " Ahmed@GMAIL.COM " and "ahmed@gmail.com" are the same person for the
 * per-event duplicate rule.
 *
 * Deliberately trim + lowercase only. No Gmail dot-stripping or plus-address
 * folding: the rule has to stay predictable, and `public.normalize_email` in
 * the database does exactly the same thing.
 */

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;

/** Trims and lowercases. Returns null for an empty input. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  return value === '' ? null : value;
}

/** True when the input normalizes to something that looks like an address. */
export function isValidEmail(input: string | null | undefined): boolean {
  const normalized = normalizeEmail(input);
  return normalized !== null && EMAIL_PATTERN.test(normalized);
}
