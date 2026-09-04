import { describe, expect, it } from 'vitest';
import {
  attendeeDetailsSchema,
  startVerificationSchema,
  submitOrderSchema,
} from '@/lib/validation/schemas';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

describe('attendee details', () => {
  it('accepts a valid submission and stores the phone normalized', () => {
    const result = attendeeDetailsSchema.safeParse({ name: 'Ahmed Ali', phone: '0551234567' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe('+966551234567');
  });

  it('accepts Arabic names', () => {
    expect(attendeeDetailsSchema.safeParse({ name: 'أحمد علي', phone: '0551234567' }).success).toBe(
      true,
    );
  });

  it('resolves every accepted Saudi format to the same identity', () => {
    const formats = ['0501234567', '+966501234567', '966501234567', '00966501234567', '501234567'];
    const normalized = new Set(
      formats.map((phone) => {
        const parsed = attendeeDetailsSchema.safeParse({ name: 'Hamid', phone });
        return parsed.success ? parsed.data.phone : phone;
      }),
    );

    expect([...normalized]).toEqual(['+966501234567']);
  });

  it('rejects an invalid phone with the phone_invalid code', () => {
    const result = attendeeDetailsSchema.safeParse({ name: 'Ahmed Ali', phone: '0112345678' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'phone_invalid')).toBe(true);
    }
  });

  it('rejects one-character names', () => {
    expect(attendeeDetailsSchema.safeParse({ name: 'A', phone: '0551234567' }).success).toBe(false);
  });

  it('does not ask for an email address at all', () => {
    const result = attendeeDetailsSchema.safeParse({
      name: 'Ahmed Ali',
      phone: '0551234567',
      email: 'a@b.com',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('email');
  });
});

describe('starting verification', () => {
  it('requires an event', () => {
    expect(
      startVerificationSchema.safeParse({ name: 'Ahmed Ali', phone: '0551234567' }).success,
    ).toBe(false);

    expect(
      startVerificationSchema.safeParse({
        name: 'Ahmed Ali',
        phone: '0551234567',
        eventSlug: 'leap-riyadh',
      }).success,
    ).toBe(true);
  });
});

describe('order submission', () => {
  const valid = {
    eventSlug: 'leap-riyadh',
    restaurantId: VALID_UUID,
    menuItemId: VALID_UUID,
  };

  it('accepts a well-formed submission', () => {
    expect(submitOrderSchema.safeParse(valid).success).toBe(true);
  });

  it('never carries a price — the client cannot influence what an order costs', () => {
    const result = submitOrderSchema.safeParse({ ...valid, price: 1, unit_price: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('price');
      expect(result.data).not.toHaveProperty('unit_price');
    }
  });

  it('never carries an identity — that comes from the verification record', () => {
    const result = submitOrderSchema.safeParse({
      ...valid,
      phone: '+966500000000',
      name: 'Someone Else',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('phone');
      expect(result.data).not.toHaveProperty('name');
    }
  });

  it('rejects ids that are not uuids', () => {
    expect(submitOrderSchema.safeParse({ ...valid, menuItemId: 'burger' }).success).toBe(false);
    expect(submitOrderSchema.safeParse({ ...valid, restaurantId: '1' }).success).toBe(false);
  });
});
