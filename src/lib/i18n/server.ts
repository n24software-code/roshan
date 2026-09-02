import { notFound } from 'next/navigation';
import { createTranslator } from './index';
import { isLocale, type Locale } from './config';

/** Validates the `[locale]` route segment and returns its translator. */
export async function getLocaleContext(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale: locale as Locale, t: createTranslator(locale) };
}
