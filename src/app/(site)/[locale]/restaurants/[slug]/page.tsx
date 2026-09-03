import { MediaImage } from '@/components/ui/MediaImage';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocaleContext } from '@/lib/i18n/server';
import { localized } from '@/lib/i18n';
import { getActiveEvent, getRestaurantBySlug, getRestaurantMenu } from '@/lib/data/customer';
import { MenuBrowser } from '@/components/customer/MenuBrowser';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClass } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const event = await getActiveEvent();
  if (!event) return {};
  const restaurant = await getRestaurantBySlug(event.id, slug);
  return { title: restaurant ? localized(restaurant, 'name', locale === 'ar' ? 'ar' : 'en') : '' };
}

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, t } = await getLocaleContext(params as Promise<{ locale: string }>);
  const { slug } = await params;

  const event = await getActiveEvent();
  if (!event) notFound();

  const restaurant = await getRestaurantBySlug(event.id, slug);
  if (!restaurant) notFound();

  const { categories, items } = await getRestaurantMenu(restaurant.id);

  const name = localized(restaurant, 'name', locale);
  const description = localized(restaurant, 'description', locale);
  const cuisine = localized(restaurant, 'cuisine', locale);

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <section className="relative isolate overflow-hidden bg-brand-900 text-white">
        {restaurant.cover_image_url && (
          <MediaImage
            reference={restaurant.cover_image_url}
            alt=""
            kind="restaurant"
            priority
            sizes="100vw"
            imageClassName="opacity-40"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-brand-900 via-brand-900/85 to-brand-900/50"
        />
        <div className="container-page relative py-8 md:py-14">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-100 hover:text-white"
          >
            <span aria-hidden="true" className="rtl:rotate-180">
              ←
            </span>
            {t('common.back')}
          </Link>

          <div className="mt-6 md:mt-10">
            {cuisine && (
              <p className="text-xs font-semibold tracking-[0.2em] text-brand-200 uppercase">
                {cuisine}
              </p>
            )}
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance md:text-5xl">
              {name}
            </h1>
            {description && (
              <p className="mt-3 max-w-xl leading-relaxed text-brand-100">{description}</p>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- menu */}
      <div className="container-page">
        {restaurant.status !== 'active' ? (
          <div className="py-16">
            <EmptyState
              title={t('restaurant.closedTitle')}
              body={t('restaurant.closedBody')}
              action={
                <Link href={`/${locale}`} className={buttonClass('primary', 'md')}>
                  {t('restaurant.backToRestaurants')}
                </Link>
              }
            />
          </div>
        ) : (
          <MenuBrowser
            locale={locale}
            eventSlug={event.slug}
            restaurant={restaurant}
            categories={categories}
            items={items}
          />
        )}
      </div>
    </>
  );
}
