import { describe, expect, it } from 'vitest';
import { mapDatabaseError, ORDER_ERROR_CODES } from '@/lib/orders/errors';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('error mapping', () => {
  it('maps every place_order sentinel to a code', () => {
    const cases: [string, string][] = [
      ['EVENT_INACTIVE', 'event_inactive'],
      ['RESTAURANT_DISABLED', 'restaurant_disabled'],
      ['ITEM_UNAVAILABLE', 'item_unavailable'],
      ['ITEM_RESTAURANT_MISMATCH', 'item_restaurant_mismatch'],
      ['NOT_VERIFIED', 'not_verified'],
      ['INVALID_PHONE', 'phone_invalid'],
      ['VERIFICATION_EXPIRED', 'verification_expired'],
      ['EVENT_MISMATCH', 'event_mismatch'],
      ['RESEND_TOO_SOON', 'resend_too_soon'],
      ['RATE_LIMITED', 'otp_rate_limited'],
    ];

    for (const [sentinel, code] of cases) {
      expect(mapDatabaseError(`ERROR: ${sentinel} in function place_order`)).toBe(code);
    }
  });

  it('falls back to unknown for unrecognised database errors', () => {
    expect(mapDatabaseError('connection reset by peer')).toBe('unknown');
  });

  it('never leaks a raw database error to the guest', () => {
    const raw = 'duplicate key value violates unique constraint "orders_one_per_phone_per_event"';
    expect(mapDatabaseError(raw)).toBe('unknown');
  });

  it('has a translation for every error code in both languages', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(en.errors, `en.${code}`).toHaveProperty(code);
      expect(ar.errors, `ar.${code}`).toHaveProperty(code);
    }
  });
});
