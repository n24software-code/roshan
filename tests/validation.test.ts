import { describe, expect, it } from 'vitest';
import { customerDetailsSchema, otpCodeSchema, placeOrderSchema } from '@/lib/validation/schemas';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

describe('customer details', () => {
  it('accepts a valid submission and stores the phone normalized', () => {
    const result = customerDetailsSchema.safeParse({
      name: 'Ahmed Ali',
      email: 'Ahmed@Example.COM',
      phone: '0551234567',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('+966551234567');
      expect(result.data.email).toBe('ahmed@example.com');
    }
  });

  it('accepts Arabic names', () => {
    const result = customerDetailsSchema.safeParse({
      name: 'أحمد علي',
      email: 'a@b.com',
      phone: '0551234567',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid phone with the phone_invalid code', () => {
    const result = customerDetailsSchema.safeParse({
      name: 'Ahmed Ali',
      email: 'a@b.com',
      phone: '0112345678',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'phone_invalid')).toBe(true);
    }
  });

  it('rejects malformed emails and one-character names', () => {
    for (const email of ['nope', 'a@b', 'a b@c.com', '']) {
      const result = customerDetailsSchema.safeParse({
        name: 'Ahmed Ali',
        email,
        phone: '0551234567',
      });
      expect(result.success, email).toBe(false);
    }

    expect(
      customerDetailsSchema.safeParse({ name: 'A', email: 'a@b.com', phone: '0551234567' }).success,
    ).toBe(false);
  });
});

describe('otp code', () => {
  it('requires exactly six digits', () => {
    expect(otpCodeSchema.safeParse('123456').success).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', '12 34 56', '']) {
      expect(otpCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });
});

describe('order submission', () => {
  const valid = {
    eventSlug: 'leap-riyadh',
    restaurantId: VALID_UUID,
    menuItemId: VALID_UUID,
    name: 'Ahmed Ali',
    email: 'a@b.com',
  };

  it('accepts a well-formed submission', () => {
    expect(placeOrderSchema.safeParse(valid).success).toBe(true);
  });

  it('never carries a price — the client cannot influence what an order costs', () => {
    const result = placeOrderSchema.safeParse({ ...valid, price: 1, unit_price: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('price');
      expect(result.data).not.toHaveProperty('unit_price');
    }
  });

  it('rejects ids that are not uuids', () => {
    expect(placeOrderSchema.safeParse({ ...valid, menuItemId: 'burger' }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...valid, restaurantId: '1' }).success).toBe(false);
  });
});
