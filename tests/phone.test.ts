import { describe, expect, it } from 'vitest';
import {
  formatNationalInput,
  formatSaudiPhone,
  isValidSaudiPhone,
  maskSaudiPhone,
  normalizeSaudiPhone,
} from '@/lib/phone';

describe('Saudi phone normalization', () => {
  it('accepts every supported input format and reduces it to one E.164 value', () => {
    const expected = '+966551234567';
    const inputs = [
      '0551234567',
      '551234567',
      '+966551234567',
      '966551234567',
      '00966551234567',
      '+966 55 123 4567',
      '055-123-4567',
      '(055) 123 4567',
      '  0551234567  ',
    ];

    for (const input of inputs) {
      expect(normalizeSaudiPhone(input), input).toBe(expected);
    }
  });

  it('treats 05XXXXXXXX and +9665XXXXXXXX as the same customer', () => {
    expect(normalizeSaudiPhone('0551234567')).toBe(normalizeSaudiPhone('+966551234567'));
  });

  it('normalizes Arabic-Indic digits', () => {
    expect(normalizeSaudiPhone('٠٥٥١٢٣٤٥٦٧')).toBe('+966551234567');
  });

  it('accepts every assigned mobile prefix', () => {
    for (const second of ['0', '1', '3', '4', '5', '6', '7', '8', '9']) {
      expect(isValidSaudiPhone(`05${second}1234567`), `05${second}`).toBe(true);
    }
  });

  it('rejects landlines, wrong lengths and non-Saudi numbers', () => {
    const invalid = [
      '0112345678', // Riyadh landline
      '0126543210', // Jeddah landline
      '055123456', // too short
      '05512345678', // too long
      '+971551234567', // UAE
      '+14155552671', // US
      '0521234567', // unassigned prefix
      '',
      'not a phone',
      '+966',
    ];

    for (const input of invalid) {
      expect(normalizeSaudiPhone(input), input).toBeNull();
      expect(isValidSaudiPhone(input), input).toBe(false);
    }
  });

  it('rejects null and undefined', () => {
    expect(normalizeSaudiPhone(null)).toBeNull();
    expect(normalizeSaudiPhone(undefined)).toBeNull();
  });

  it('formats for display and masks for confirmation', () => {
    expect(formatSaudiPhone('0551234567')).toBe('+966 55 123 4567');
    expect(maskSaudiPhone('0551234567')).toBe('+966 55 ••• 4567');
  });

  it('groups digits as the guest types', () => {
    expect(formatNationalInput('551234567')).toBe('55 123 4567');
    expect(formatNationalInput('0551234567')).toBe('55 123 4567');
    expect(formatNationalInput('55')).toBe('55');
    expect(formatNationalInput('55123456789999')).toBe('55 123 4567');
  });
});
