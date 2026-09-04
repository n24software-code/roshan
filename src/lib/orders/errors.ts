/**
 * Error codes shared between the server actions and the message catalogues.
 * Every code has a matching key under `errors.*` in en.json / ar.json.
 */
export const ORDER_ERROR_CODES = [
  'name_invalid',
  'email_invalid',
  'phone_required',
  'phone_invalid',
  'not_authenticated',
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
  'order_failed',
  'network',
  'unknown',
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** Maps the sentinel raised by the `place_order` database function onto a code. */
export function mapDatabaseError(message: string): OrderErrorCode {
  const sentinel = message.match(
    /\b(NOT_AUTHENTICATED|INVALID_PHONE|INVALID_NAME|INVALID_EMAIL|EVENT_NOT_FOUND|EVENT_INACTIVE|RESTAURANT_NOT_FOUND|RESTAURANT_DISABLED|RESTAURANT_NOT_IN_EVENT|ITEM_NOT_FOUND|ITEM_UNAVAILABLE|ITEM_RESTAURANT_MISMATCH)\b/,
  )?.[1];

  switch (sentinel) {
    case 'NOT_AUTHENTICATED':
      return 'not_authenticated';
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
      break;
  }

  // A unique violation that escaped `place_order`'s own handling still means
  // one thing to the guest: they already have an order for this event.
  if (
    /duplicate key value|orders_event_(phone|email)_key|orders_one_per_customer_per_event/i.test(
      message,
    )
  ) {
    return 'duplicate_order';
  }

  return 'unknown';
}
