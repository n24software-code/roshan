import Image from 'next/image';
import Link from 'next/link';
import { createTranslator, localized } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import type { RestaurantRow } from '@/types/database';
import { cn } from '@/lib/cn';

export function RestaurantCard({
  restaurant,
  locale,
  priority,
}: {
  restaurant: RestaurantRow;
  locale: Locale;
  priority?: boolean;
}) {
  const t = createTranslator(locale);
  const isActive = restaurant.status === 'active';
  const name = localized(restaurant, 'name', locale);
  const description = localized(restaurant, 'description', locale);
  const cuisine = localized(restaurant, 'cuisine', locale);

  const body = (
    <>
      <div className="relative aspect-[16/10] overflow-hidden bg-sand-200">
        {restaurant.cover_image_url ? (
          <Image
            src={restaurant.cover_image_url}
            alt=""
            fill
            priority={priority}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className={cn(
              'object-cover transition-transform duration-500',
              isActive ? 'group-hover:scale-105' : 'grayscale',
            )}
          />
        ) : (
          <div className="pattern-geometric h-full w-full" aria-hidden="true" />
        )}

        {cuisine && (
          <span className="absolute bottom-3 start-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-ink-700 shadow-sm">
            {cuisine}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight text-ink-900">{name}</h3>
        </div>

        {description && <p className="line-clamp-2 text-sm text-ink-500">{description}</p>}

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold',
              isActive ? 'text-brand-700' : 'text-ink-500',
            )}
          >
            <span aria-hidden="true">{isActive ? '●' : '○'}</span>
            {isActive ? t('restaurantCard.available') : t('restaurantCard.unavailable')}
          </span>

          {isActive && (
            <span className="text-sm font-semibold text-brand-700 group-hover:underline">
              {t('restaurantCard.view')}
              <span aria-hidden="true" className="ms-1 inline-block rtl:rotate-180">
                →
              </span>
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (!isActive) {
    return (
      <div
        className="card-surface flex flex-col overflow-hidden opacity-75"
        aria-label={`${name} — ${t('restaurantCard.unavailable')}`}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/${locale}/restaurants/${restaurant.slug}`}
      className="card-surface group flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]"
    >
      {body}
    </Link>
  );
}
