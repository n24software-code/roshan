import Image from 'next/image';
import { getLocaleContext } from '@/lib/i18n/server';
import { localized } from '@/lib/i18n';
import { getActiveEvent, getEventRestaurants } from '@/lib/data/customer';
import { RestaurantCard } from '@/components/customer/RestaurantCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClass } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await getLocaleContext(params);
  const event = await getActiveEvent();

  if (!event) {
    return (
      <div className="container-page py-24">
        <EmptyState title={t('home.noEvent.title')} body={t('home.noEvent.body')} />
      </div>
    );
  }

  const restaurants = await getEventRestaurants(event.id);
  const steps = ['one', 'two', 'three', 'four'] as const;

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative isolate overflow-hidden bg-brand-900 text-white">
        {event.hero_image_url && (
          <Image
            src={event.hero_image_url}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-35"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-brand-900 via-brand-900/85 to-brand-900/55"
        />
        <div className="container-page relative py-20 md:py-32">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-brand-200 uppercase">
              {t('home.eyebrow')}
            </p>
            <h1 className="mt-4 text-4xl leading-[1.1] font-extrabold tracking-tight text-balance md:text-6xl">
              {localized(event, 'name', locale)}
            </h1>
            {localized(event, 'description', locale) && (
              <p className="mt-5 max-w-xl text-base leading-relaxed text-brand-100 md:text-lg">
                {localized(event, 'description', locale)}
              </p>
            )}
            <a href="#restaurants" className={buttonClass('secondary', 'lg', 'mt-8')}>
              {t('home.cta')}
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- how it works */}
      <section className="border-b border-sand-200 bg-white">
        <div className="container-page py-14 md:py-16">
          <h2 className="text-sm font-semibold tracking-[0.16em] text-ink-500 uppercase">
            {t('home.howTitle')}
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="numeric grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-ink-900">{t(`home.steps.${step}.title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">
                    {t(`home.steps.${step}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------- restaurants */}
      <section id="restaurants" className="container-page scroll-mt-24 py-14 md:py-20">
        <header className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 md:text-4xl">
            {t('home.restaurantsTitle')}
          </h2>
          <p className="mt-3 text-ink-500">{t('home.restaurantsSubtitle')}</p>
        </header>

        {restaurants.length === 0 ? (
          <div className="mt-10">
            <EmptyState title={t('home.noRestaurants')} />
          </div>
        ) : (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((restaurant, index) => (
              <li key={restaurant.id} className="animate-fade-up">
                <RestaurantCard restaurant={restaurant} locale={locale} priority={index < 3} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
