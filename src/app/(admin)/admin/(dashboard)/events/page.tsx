import { requireAdmin } from '@/lib/auth/admin';
import { getEvents } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { EventManager } from '@/components/admin/EventManager';

export const metadata = { title: 'Events' };
export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const { supabase } = await requireAdmin();
  const events = await getEvents(supabase);

  return (
    <>
      <PageHeader
        title="Events"
        description="One event runs at a time. Activating an event stands the previous one down."
      />
      <EventManager events={events} />
    </>
  );
}
