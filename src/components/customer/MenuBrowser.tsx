'use client';

import { MediaImage } from '@/components/ui/MediaImage';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createTranslator, formatPrice, localized } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { matchesQuery } from '@/lib/search';
import { selectionStore, useStoredSelection } from '@/lib/selection';
import { cn } from '@/lib/cn';
import { buttonClass } from '@/components/ui/Button';
import type { MenuCategoryRow, MenuItemRow, RestaurantRow } from '@/types/database';

/**
 * Menu browsing and selection.
 *
 * A guest may pick at most one item from each category of this restaurant.
 * There is still no cart and no quantity control: choosing another item in the
 * same category replaces it, and choosing the selected item again clears it.
 * The category filter is a browsing aid only — it never touches the selection.
 */
export function MenuBrowser({
  locale,
  eventSlug,
  restaurant,
  categories,
  items,
}: {
  locale: Locale;
  eventSlug: string;
  restaurant: RestaurantRow;
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
}) {
  const t = createTranslator(locale);
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // The stored selection *is* the state: choosing an item writes to the store
  // and every subscriber re-renders. A choice made earlier for this restaurant
  // is therefore restored automatically, with no effect and no copy in state.
  //
  // A selection belonging to another restaurant is ignored outright, and items
  // that have since disappeared or sold out are dropped, so a stale store can
  // never show a selection the server would refuse.
  const stored = useStoredSelection();
  const selectedIds = useMemo(() => {
    if (!stored || stored.restaurantId !== restaurant.id) return new Set<string>();
    return new Set(
      (stored.items ?? [])
        .map((entry) => items.find((item) => item.id === entry.menuItemId))
        .filter((item): item is MenuItemRow => Boolean(item?.is_available))
        .map((item) => item.id),
    );
  }, [stored, restaurant.id, items]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (categoryId && item.category_id !== categoryId) return false;
      // Search only the active language, as the interface never mixes the two.
      return matchesQuery(
        query,
        localized(item, 'name', locale),
        localized(item, 'description', locale),
      );
    });
  }, [items, categoryId, query, locale]);

  const grouped = useMemo(() => {
    const buckets = categories
      .map((category) => ({
        category,
        items: visible.filter((item) => item.category_id === category.id),
      }))
      .filter((bucket) => bucket.items.length > 0);

    const uncategorized = visible.filter(
      (item) => !item.category_id || !categories.some((c) => c.id === item.category_id),
    );
    if (uncategorized.length > 0) {
      buckets.push({ category: null as unknown as MenuCategoryRow, items: uncategorized });
    }
    return buckets;
  }, [categories, visible]);

  const selected = items.filter((item) => selectedIds.has(item.id));
  const total = selected.reduce((sum, item) => sum + Number(item.price), 0);

  function select(item: MenuItemRow) {
    if (!item.is_available) return;
    selectionStore.toggle(
      { eventSlug, restaurantSlug: restaurant.slug, restaurantId: restaurant.id },
      { menuItemId: item.id, categoryId: item.category_id },
    );
  }

  return (
    <>
      {/* -------------------------------------------------- search + filters */}
      <div className="sticky top-16 z-30 -mx-5 border-b border-sand-200 bg-sand-50/95 px-5 py-4 backdrop-blur-md md:top-20 md:-mx-8 md:px-8">
        <div className="container-page !px-0">
          <label htmlFor="menu-search" className="sr-only">
            {t('restaurant.searchPlaceholder')}
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-ink-400"
            >
              ⌕
            </span>
            <input
              id="menu-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('restaurant.searchPlaceholder')}
              className="h-12 w-full rounded-full border border-sand-300 bg-white ps-11 pe-4 text-base text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>

          {categories.length > 0 && (
            <div
              className="scrollbar-none mt-3 flex gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label={t('restaurant.menu')}
            >
              <CategoryChip
                label={t('restaurant.allCategories')}
                active={categoryId === null}
                onClick={() => setCategoryId(null)}
              />
              {categories.map((category) => (
                <CategoryChip
                  key={category.id}
                  label={localized(category, 'name', locale)}
                  active={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- the menu */}
      <div className="pb-32">
        {visible.length === 0 ? (
          <p className="card-surface mt-8 px-6 py-12 text-center text-ink-500">
            {items.length === 0 ? t('restaurant.noItems') : t('restaurant.noResults')}
          </p>
        ) : (
          grouped.map((bucket, index) => (
            <section key={bucket.category?.id ?? `group-${index}`} className="mt-10 first:mt-8">
              {bucket.category && (
                <h2 className="text-sm font-bold tracking-[0.14em] text-ink-500 uppercase">
                  {localized(bucket.category, 'name', locale)}
                </h2>
              )}
              <ul className="mt-4 grid gap-4 md:grid-cols-2">
                {bucket.items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    locale={locale}
                    selected={selectedIds.has(item.id)}
                    onSelect={() => select(item)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* ------------------------------------------------- continue bar */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-sand-200 bg-white/95 backdrop-blur-md">
          <div className="container-page flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">
                {selected.length === 1
                  ? localized(selected[0], 'name', locale)
                  : t('restaurant.itemsSelected', { count: selected.length })}
              </p>
              <p className="numeric text-sm font-semibold text-brand-700">
                {formatPrice(total, locale)}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                router.push(`/${locale}/order?items=${selected.map((item) => item.id).join(',')}`)
              }
              className={buttonClass('primary', 'lg', 'shrink-0')}
            >
              {t('common.continue')}
              <span aria-hidden="true" className="rtl:rotate-180">
                →
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
        active
          ? 'border-brand-700 bg-brand-700 text-white'
          : 'border-sand-300 bg-white text-ink-600 hover:bg-sand-100',
      )}
    >
      {label}
    </button>
  );
}

function MenuItemCard({
  item,
  locale,
  selected,
  onSelect,
}: {
  item: MenuItemRow;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = createTranslator(locale);
  const name = localized(item, 'name', locale);
  const description = localized(item, 'description', locale);
  const available = item.is_available;

  return (
    <li>
      <article
        className={cn(
          'card-surface flex h-full gap-4 p-4 transition-all duration-200',
          selected && 'border-brand-500 ring-2 ring-brand-500/25',
          !available && 'opacity-60',
        )}
      >
        {/* Always rendered so every card keeps the same shape, image or not. */}
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-sand-200 sm:h-28 sm:w-28">
          <MediaImage
            reference={item.image_url}
            alt=""
            sizes="112px"
            imageClassName={cn(!available && 'grayscale')}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="font-bold text-ink-900">{name}</h3>
          {description && (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-500">{description}</p>
          )}

          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <p className="numeric font-bold text-ink-900">
              {formatPrice(Number(item.price), locale)}
            </p>

            {available ? (
              <button
                type="button"
                onClick={onSelect}
                aria-pressed={selected}
                className={buttonClass(selected ? 'primary' : 'secondary', 'sm', 'min-w-[6.5rem]')}
              >
                {selected ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    {t('restaurant.selected')}
                  </>
                ) : (
                  t('restaurant.select')
                )}
              </button>
            ) : (
              <span className="rounded-full bg-sand-200 px-3 py-1.5 text-xs font-semibold text-ink-600">
                {t('restaurant.unavailable')}
              </span>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}
