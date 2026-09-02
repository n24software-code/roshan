import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { DEFAULT_LOCALE, type Locale } from './config';

export type Messages = typeof en;

const CATALOGS: Record<Locale, Messages> = { en, ar: ar as Messages };

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}

type Values = Record<string, string | number>;

function resolve(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export type Translator = (key: string, values?: Values) => string;

/** Dot-path translator. Falls back to English, then to the key itself. */
export function createTranslator(locale: Locale): Translator {
  const primary = getMessages(locale);
  const fallback = getMessages(DEFAULT_LOCALE);
  return (key, values) =>
    interpolate(resolve(primary, key) ?? resolve(fallback, key) ?? key, values);
}

/** Picks the field matching the active locale from a bilingual database row. */
export function localized<T extends object>(row: T, base: string, locale: Locale): string {
  const record = row as Record<string, unknown>;
  const value = record[`${base}_${locale}`] ?? record[`${base}_en`];
  return typeof value === 'string' ? value : '';
}

/** Formats a price with the locale's numerals and the SAR label. */
export function formatPrice(amount: number, locale: Locale): string {
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return locale === 'ar' ? `${formatted} ريال` : `SAR ${formatted}`;
}
