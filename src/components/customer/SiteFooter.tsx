import { createTranslator, localized } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import type { EventRow } from '@/types/database';

export function SiteFooter({ locale, event }: { locale: Locale; event: EventRow | null }) {
  const t = createTranslator(locale);
  const name = event ? localized(event, 'name', locale) : t('meta.title');
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-sand-200 bg-white">
      <div className="container-page flex flex-col gap-2 py-10 text-sm text-ink-500 md:flex-row md:items-center md:justify-between">
        <p className="font-semibold text-ink-700">{name}</p>
        <p>{t('footer.help')}</p>
        <p className="numeric">
          © {year} · {t('footer.rights')}
        </p>
      </div>
    </footer>
  );
}
