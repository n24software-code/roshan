'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocalePreference } from '@/lib/i18n/actions';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/cn';

/**
 * Swaps the locale segment of the current path. The preference is stored in a
 * cookie by a server action, so middleware can honour it on the next visit.
 */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    const rest = pathname.replace(/^\/(en|ar)(?=\/|$)/, '');

    startTransition(async () => {
      await setLocalePreference(next);
      router.push(`/${next}${rest}`);
      router.refresh();
    });
  }

  return (
    <div
      className="inline-flex items-center rounded-full border border-sand-300 bg-white p-0.5"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          onClick={() => switchTo(code)}
          disabled={pending}
          aria-current={code === locale ? 'true' : undefined}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            code === locale ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-sand-100',
          )}
        >
          {code === 'ar' ? 'العربية' : 'English'}
        </button>
      ))}
    </div>
  );
}
