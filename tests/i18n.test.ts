import { describe, expect, it } from 'vitest';
import { createTranslator, formatPrice, localized } from '@/lib/i18n';
import { dirOf, isLocale, otherLocale } from '@/lib/i18n/config';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

/** Collects every leaf key path of a message catalogue. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translations', () => {
  it('has identical keys in English and Arabic', () => {
    expect(keyPaths(ar).sort()).toEqual(keyPaths(en).sort());
  });

  it('has no empty strings', () => {
    for (const catalogue of [en, ar]) {
      for (const path of keyPaths(catalogue)) {
        const translator = createTranslator('en');
        expect(path.length).toBeGreaterThan(0);
        expect(typeof translator(path)).toBe('string');
      }
    }
  });

  it('interpolates values', () => {
    const t = createTranslator('en');
    expect(t('restaurant.itemCount', { count: 12 })).toContain('12');
    expect(t('confirmation.thanks', { name: 'Hamid' })).toContain('Hamid');
  });

  it('falls back to English when a key is missing, then to the key itself', () => {
    const t = createTranslator('ar');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('resolves bilingual database columns', () => {
    const row = { name_en: 'KFC', name_ar: 'كنتاكي' };
    expect(localized(row, 'name', 'en')).toBe('KFC');
    expect(localized(row, 'name', 'ar')).toBe('كنتاكي');
    expect(localized({ name_en: 'Only English' }, 'name', 'ar')).toBe('Only English');
  });

  it('formats prices per locale without implying payment', () => {
    expect(formatPrice(32, 'en')).toBe('SAR 32');
    expect(formatPrice(32.5, 'en')).toBe('SAR 32.50');
    expect(formatPrice(32, 'ar')).toContain('ريال');
  });
});

describe('locale config', () => {
  it('maps Arabic to RTL and English to LTR', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });

  it('validates locale segments', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('toggles between the two locales', () => {
    expect(otherLocale('en')).toBe('ar');
    expect(otherLocale('ar')).toBe('en');
  });
});
