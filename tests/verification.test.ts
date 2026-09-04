import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  generateVerificationCode,
  hashSessionToken,
  hashVerificationCode,
  normalizeVerificationCode,
  safeEquals,
} from '@/lib/verification/codes';
import { buildVerificationMessage, extractVerificationCode } from '@/lib/verification/message';

beforeAll(() => {
  process.env.PHONE_VERIFICATION_SECRET = 'test-secret-value-long-enough';
});

describe('verification codes', () => {
  it('generates six characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateVerificationCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 200 }, generateVerificationCode));
    expect(codes.size).toBeGreaterThan(180);
  });

  it('normalizes case and spacing but rejects ambiguous characters', () => {
    expect(normalizeVerificationCode('k4m 7qx')).toBe('K4M7QX');
    expect(normalizeVerificationCode('K4M-7QX')).toBe('K4M7QX');
    for (const bad of ['K4M7Q', 'K4M7QXY', 'K4M7Q0', 'K4M7QI', '']) {
      expect(normalizeVerificationCode(bad), bad).toBeNull();
    }
  });

  it('hashes a code to something that is not the code', () => {
    const hash = hashVerificationCode('K4M7QX');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('K4M7QX');
    expect(hashVerificationCode('K4M7QX')).toBe(hash);
    expect(hashVerificationCode('K4M7QY')).not.toBe(hash);
  });

  it('is case-insensitive on the code but not on anything else', () => {
    expect(hashVerificationCode('k4m7qx')).toBe(hashVerificationCode('K4M7QX'));
  });

  it('issues session tokens with enough entropy to be unguessable', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(40);
  });

  it('stores only a digest of the session token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEquals('abc', 'abc')).toBe(true);
    expect(safeEquals('abc', 'abd')).toBe(false);
    expect(safeEquals('abc', 'abcd')).toBe(false);
  });
});

describe('the WhatsApp message', () => {
  it('round-trips the code it was built with', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateVerificationCode();
      const message = buildVerificationMessage({ code, phone: '+966501234567' });
      expect(message).toContain('+966501234567');
      expect(extractVerificationCode(message)).toBe(code);
    }
  });

  it('reads the code back from a lowercased or reflowed message', () => {
    expect(extractVerificationCode('verification code: k4m7qx')).toBe('K4M7QX');
    expect(extractVerificationCode('ROSHN Event Verification\nVerification Code:K4M7QX')).toBe(
      'K4M7QX',
    );
  });

  it('returns null when there is no code to read', () => {
    expect(extractVerificationCode('hello')).toBeNull();
    expect(extractVerificationCode('')).toBeNull();
  });
});
