import Image from 'next/image';
import Link from 'next/link';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { Locale } from '@/lib/i18n/config';
import { localized } from '@/lib/i18n';
import type { EventRow } from '@/types/database';

export function SiteHeader({ locale, event }: { locale: Locale; event: EventRow | null }) {
  const name = event ? localized(event, 'name', locale) : '';

  return (
    <header className="sticky top-0 z-40 border-b border-sand-200 bg-sand-50/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4 md:h-20">
        <Link href={`/${locale}`} className="flex min-w-0 items-center gap-3">
          {/* The mark is a white SVG, so it sits on a deep-green plate to stay
              legible against the light header. Height is fixed and the width
              follows, preserving the 172:50 aspect ratio. */}
          <span className="flex h-10 shrink-0 items-center rounded-lg bg-brand-700 px-3 md:h-11 md:px-3.5">
            <Image
              src="/roshan-logo.svg"
              alt="Roshan"
              width={172}
              height={50}
              priority
              unoptimized
              className="h-[18px] w-auto md:h-5"
            />
          </span>

          {/* On the narrowest screens the mark alone carries the branding, so the
              event name yields space to the language switcher. */}
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-bold tracking-tight text-ink-900 md:text-base">
              {name}
            </span>
          </span>
        </Link>
        <LanguageSwitcher locale={locale} />
      </div>
    </header>
  );
}
