/**
 * Error codes shared between the server actions and the message catalogues.
 * Every code has a matching key under `errors.*` in en.json / ar.json.
 */
export const ORDER_ERROR_CODES = [
  'name_invalid',
  'email_invalid',
  'phone_required',
  'phone_invalid',
  'verification_required',
  'verification_pending',
  'verification_expired',
  'verification_failed',
  'verification_not_configured',
  'resend_too_soon',
  'otp_rate_limited',
  'otp_expired',
  'not_verified',
  'invalid_selection',
  'event_not_found',
  'event_inactive',
  'event_mismatch',
  'restaurant_not_found',
  'restaurant_disabled',
  'restaurant_not_in_event',
  'item_not_found',
  'item_unavailable',
  'item_restaurant_mismatch',
  'duplicate_order',
  'network',
  'unknown',
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** Sentinel raised by a database function -> the code shown to the guest. */
const SENTINELS: Record<string, OrderErrorCode> = {
  NOT_VERIFIED: 'not_verified',
  VERIFICATION_EXPIRED: 'verification_expired',
  INVALID_REQUEST: 'invalid_selection',
  INVALID_PHONE: 'phone_invalid',
  INVALID_NAME: 'name_invalid',
  INVALID_EMAIL: 'email_invalid',
  RESEND_TOO_SOON: 'resend_too_soon',
  RATE_LIMITED: 'otp_rate_limited',
  EVENT_NOT_FOUND: 'event_not_found',
  EVENT_INACTIVE: 'event_inactive',
  EVENT_MISMATCH: 'event_mismatch',
  RESTAURANT_NOT_FOUND: 'restaurant_not_found',
  RESTAURANT_DISABLED: 'restaurant_disabled',
  RESTAURANT_NOT_IN_EVENT: 'restaurant_not_in_event',
  ITEM_NOT_FOUND: 'item_not_found',
  ITEM_UNAVAILABLE: 'item_unavailable',
  ITEM_RESTAURANT_MISMATCH: 'item_restaurant_mismatch',
};

const SENTINEL_PATTERN = new RegExp(`\\b(${Object.keys(SENTINELS).join('|')})\\b`);

/**
 * Maps a sentinel raised by a database function onto a code. Anything else —
 * including a raw Postgres error — collapses to `unknown`, so constraint names,
 * column names and SQL text never reach the browser.
 */
export function mapDatabaseError(message: string): OrderErrorCode {
  const sentinel = message.match(SENTINEL_PATTERN)?.[1];
  return sentinel ? SENTINELS[sentinel] : 'unknown';
}
