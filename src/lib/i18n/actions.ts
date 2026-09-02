'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, isLocale, type Locale } from './config';

/** Remembers the guest's language choice for a year. */
export async function setLocalePreference(locale: Locale) {
  if (!isLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
