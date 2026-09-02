import type { Metadata } from 'next';
import { Montserrat, Tajawal } from 'next/font/google';
import { notFound } from 'next/navigation';
import '@/app/globals.css';
import { SiteHeader } from '@/components/customer/SiteHeader';
import { SiteFooter } from '@/components/customer/SiteFooter';
import { LOCALES, dirOf, isLocale } from '@/lib/i18n/config';
import { createTranslator } from '@/lib/i18n';
import { getActiveEvent } from '@/lib/data/customer';

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
});

const tajawal = Tajawal({
  subsets: ['arabic'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-tajawal',
  display: 'swap',
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = createTranslator(isLocale(locale) ? locale : 'en');
  const event = await getActiveEvent().catch(() => null);
  const name = event ? (locale === 'ar' ? event.name_ar : event.name_en) : t('meta.title');

  return {
    title: { default: name, template: `%s · ${name}` },
    description: t('meta.description'),
    robots: { index: false },
  };
}

export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = createTranslator(locale);
  const event = await getActiveEvent().catch(() => null);

  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${montserrat.variable} ${tajawal.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
        >
          {t('common.skipToContent')}
        </a>
        <SiteHeader locale={locale} event={event} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter locale={locale} event={event} />
      </body>
    </html>
  );
}
