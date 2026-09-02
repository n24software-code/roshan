import Image from 'next/image';
import Link from 'next/link';
import { getLocaleContext } from '@/lib/i18n/server';
import { formatPrice, localized } from '@/lib/i18n';
import { getActiveEvent, getSelection } from '@/lib/data/customer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { DetailsForm } from '@/components/customer/DetailsForm';

export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { locale, t } = await getLocaleContext(params);
  const { item: menuItemId } = await searchParams;

  const event = await getActiveEvent();
  const selection = event && menuItemId ? await getSelection(event.id, menuItemId) : null;

  // Nothing chosen (or the link was stale): send the guest back to browsing.
  if (!event || !selection) {
    return (
      <div className="container-page py-20">
        <EmptyState
          title={t('selection.empty.title')}
          body={t('selection.empty.body')}
          action={
            <Link href={`/${locale}`} className={buttonClass('primary', 'md')}>
              {t('selection.empty.cta')}
            </Link>
          }
        />
      </div>
    );
  }

  const { item, restaurant } = selection;
  const restaurantClosed = restaurant.status !== 'active';
  const itemUnavailable = !item.is_available;
  const blocked = restaurantClosed || itemUnavailable;

  return (
    <div className="container-page max-w-3xl py-8 md:py-14">
      <Link
        href={`/${locale}/restaurants/${restaurant.slug}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-600 hover:text-brand-700"
      >
        <span aria-hidden="true" className="rtl:rotate-180">
          ←
        </span>
        {t('common.back')}
      </Link>

      {/* ------------------------------------------------------ selection */}
      <section className="mt-6" aria-labelledby="selection-heading">
        <h1
          id="selection-heading"
          className="text-3xl font-extrabold tracking-tight text-ink-900 md:text-4xl"
        >
          {t('selection.title')}
        </h1>
        <p className="mt-2 text-ink-500">{t('selection.subtitle')}</p>

        <div className="card-surface mt-6 overflow-hidden">
          <div className="flex gap-4 p-5">
            {item.image_url && (
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-sand-200">
                <Image src={item.image_url} alt="" fill sizes="96px" className="object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-[0.14em] text-ink-500 uppercase">
                {t('common.restaurant')}
              </p>
              <p className="font-bold text-ink-900">{localized(restaurant, 'name', locale)}</p>

              <p className="mt-3 text-xs font-semibold tracking-[0.14em] text-ink-500 uppercase">
                {t('common.item')}
              </p>
              <p className="font-bold text-ink-900">{localized(item, 'name', locale)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-sand-200 bg-sand-50 px-5 py-4">
            <span className="text-sm font-semibold text-ink-600">{t('common.price')}</span>
            <span className="numeric text-lg font-extrabold text-ink-900">
              {formatPrice(Number(item.price), locale)}
            </span>
          </div>
        </div>

        <div className="mt-3 text-center">
          <Link
            href={`/${locale}/restaurants/${restaurant.slug}`}
            className="text-sm font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800"
          >
            {t('selection.changeSelection')}
          </Link>
        </div>
      </section>

      {/* -------------------------------------------------------- details */}
      <section className="mt-12" aria-labelledby="details-heading">
        <h2
          id="details-heading"
          className="text-2xl font-extrabold tracking-tight text-ink-900 md:text-3xl"
        >
          {t('details.title')}
        </h2>
        <p className="mt-2 text-ink-500">{t('details.subtitle')}</p>

        <div className="card-surface mt-6 p-5 md:p-7">
          {blocked ? (
            <div className="space-y-5">
              <Alert tone="error">
                {restaurantClosed ? t('errors.restaurant_disabled') : t('errors.item_unavailable')}
              </Alert>
              <Link href={`/${locale}`} className={buttonClass('primary', 'md', 'w-full')}>
                {t('restaurant.backToRestaurants')}
              </Link>
            </div>
          ) : (
            <DetailsForm
              locale={locale}
              eventSlug={event.slug}
              restaurantId={restaurant.id}
              restaurantSlug={restaurant.slug}
              menuItemId={item.id}
            />
          )}
        </div>
      </section>
    </div>
  );
}
