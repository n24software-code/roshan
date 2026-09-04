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
      ['NOT_AUTHENTICATED', 'not_authenticated'],
      ['INVALID_PHONE', 'phone_invalid'],
    ];

    for (const [sentinel, code] of cases) {
      expect(mapDatabaseError(`ERROR: ${sentinel} in function place_order`)).toBe(code);
    }
  });

  it('falls back to unknown for unrecognised database errors', () => {
    expect(mapDatabaseError('connection reset by peer')).toBe('unknown');
  });

  it('reads a raw unique violation as "you already ordered"', () => {
    // The safety net for a constraint that fires outside place_order's own
    // exception block — the guest must never see a stack trace instead.
    for (const message of [
      'duplicate key value violates unique constraint "orders_event_phone_key"',
      'duplicate key value violates unique constraint "orders_event_email_key"',
      'duplicate key value violates unique constraint "orders_one_per_customer_per_event"',
    ]) {
      expect(mapDatabaseError(message)).toBe('duplicate_order');
    }
  });

  it('has no verification codes left', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(code).not.toMatch(/otp|sms|verif/i);
    }
  });

  it('has a translation for every error code in both languages', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(en.errors, `en.${code}`).toHaveProperty(code);
      expect(ar.errors, `ar.${code}`).toHaveProperty(code);
    }
  });
});
