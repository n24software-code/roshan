/**
 * Error codes shared between the server actions and the message catalogues.
 * Every code has a matching key under `errors.*` in en.json / ar.json.
 */
export const ORDER_ERROR_CODES = [
  'name_invalid',
  'email_invalid',
  'phone_required',
  'phone_invalid',
  'otp_invalid',
  'otp_incorrect',
  'otp_expired',
  'otp_rate_limited',
  'otp_send_failed',
  'sms_not_configured',
  'not_verified',
  'invalid_selection',
  'event_not_found',
  'event_inactive',
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

/** Maps the sentinel raised by the `place_order` database function onto a code. */
export function mapDatabaseError(message: string): OrderErrorCode {
  const sentinel = message.match(
    /\b(NOT_VERIFIED|INVALID_PHONE|INVALID_NAME|INVALID_EMAIL|EVENT_NOT_FOUND|EVENT_INACTIVE|RESTAURANT_NOT_FOUND|RESTAURANT_DISABLED|RESTAURANT_NOT_IN_EVENT|ITEM_NOT_FOUND|ITEM_UNAVAILABLE|ITEM_RESTAURANT_MISMATCH)\b/,
  )?.[1];

  switch (sentinel) {
    case 'NOT_VERIFIED':
      return 'not_verified';
    case 'INVALID_PHONE':
      return 'phone_invalid';
    case 'INVALID_NAME':
      return 'name_invalid';
    case 'INVALID_EMAIL':
      return 'email_invalid';
    case 'EVENT_NOT_FOUND':
      return 'event_not_found';
    case 'EVENT_INACTIVE':
      return 'event_inactive';
    case 'RESTAURANT_NOT_FOUND':
      return 'restaurant_not_found';
    case 'RESTAURANT_DISABLED':
      return 'restaurant_disabled';
    case 'RESTAURANT_NOT_IN_EVENT':
      return 'restaurant_not_in_event';
    case 'ITEM_NOT_FOUND':
      return 'item_not_found';
    case 'ITEM_UNAVAILABLE':
      return 'item_unavailable';
    case 'ITEM_RESTAURANT_MISMATCH':
      return 'item_restaurant_mismatch';
    default:
      return 'unknown';
  }
}

/** Maps a Supabase Auth OTP failure onto a code. */
export function mapAuthError(message: string, status?: number): OrderErrorCode {
  const lower = message.toLowerCase();

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many')) {
    return 'otp_rate_limited';
  }
  if (lower.includes('expired')) return 'otp_expired';
  if (lower.includes('invalid') && lower.includes('token')) return 'otp_incorrect';
  if (lower.includes('otp') || lower.includes('token')) return 'otp_incorrect';
  if (
    lower.includes('phone provider') ||
    lower.includes('sms provider') ||
    lower.includes('unsupported phone provider') ||
    lower.includes('signups not allowed') ||
    lower.includes('phone_provider_disabled')
  ) {
    return 'sms_not_configured';
  }
  return 'otp_send_failed';
}
