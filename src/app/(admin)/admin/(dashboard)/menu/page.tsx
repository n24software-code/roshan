import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth/admin';
import { getMenu, getRestaurants } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { MenuManager } from '@/components/admin/MenuManager';

export const metadata = { title: 'Menu' };
export const dynamic = 'force-dynamic';

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { restaurant: restaurantId } = await searchParams;

  const restaurants = await getRestaurants(supabase);
  const selected = restaurants.find((entry) => entry.id === restaurantId) ?? null;
  const menu = selected ? await getMenu(supabase, selected.id) : { categories: [], items: [] };

  return (
    <>
      <PageHeader
        title="Menu"
        description="Manage categories and items for each restaurant. Prices here are the only prices used when an order is created."
      />
      <Suspense fallback={null}>
        <MenuManager
          restaurants={restaurants}
          restaurant={selected}
          categories={menu.categories}
          items={menu.items}
        />
      </Suspense>
    </>
  );
}
