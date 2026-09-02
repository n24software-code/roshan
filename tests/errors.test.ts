import { describe, expect, it } from 'vitest';
import { mapAuthError, mapDatabaseError, ORDER_ERROR_CODES } from '@/lib/orders/errors';
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
    ];

    for (const [sentinel, code] of cases) {
      expect(mapDatabaseError(`ERROR: ${sentinel} in function place_order`)).toBe(code);
    }
  });

  it('falls back to unknown for unrecognised database errors', () => {
    expect(mapDatabaseError('connection reset by peer')).toBe('unknown');
  });

  it('distinguishes expired, incorrect and rate-limited OTP failures', () => {
    expect(mapAuthError('Token has expired')).toBe('otp_expired');
    expect(mapAuthError('Invalid token provided')).toBe('otp_incorrect');
    expect(mapAuthError('Email rate limit exceeded', 429)).toBe('otp_rate_limited');
    expect(mapAuthError('anything', 429)).toBe('otp_rate_limited');
    expect(mapAuthError('Unsupported phone provider')).toBe('sms_not_configured');
    // The exact message Supabase returns when Twilio credentials are not set.
    expect(mapAuthError('Unable to get SMS provider', 500)).toBe('sms_not_configured');
  });

  it('has a translation for every error code in both languages', () => {
    for (const code of ORDER_ERROR_CODES) {
      expect(en.errors, `en.${code}`).toHaveProperty(code);
      expect(ar.errors, `ar.${code}`).toHaveProperty(code);
    }
  });
});
