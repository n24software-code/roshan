import { requireAdmin } from '@/lib/auth/admin';
import { getEvents, getRestaurants } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { RestaurantManager } from '@/components/admin/RestaurantManager';

export const metadata = { title: 'Restaurants' };
export const dynamic = 'force-dynamic';

export default async function RestaurantsPage() {
  const { supabase } = await requireAdmin();
  const [restaurants, events] = await Promise.all([getRestaurants(supabase), getEvents(supabase)]);

  return (
    <>
      <PageHeader
        title="Restaurants"
        description="Disabling a restaurant stops new orders immediately. Existing orders are unaffected."
      />
      <RestaurantManager restaurants={restaurants} events={events} />
    </>
  );
}
