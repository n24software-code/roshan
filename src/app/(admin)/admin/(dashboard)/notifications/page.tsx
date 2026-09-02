import { requireAdmin } from '@/lib/auth/admin';
import { getNotifications } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { NotificationList } from '@/components/admin/NotificationList';

export const metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { supabase } = await requireAdmin();
  const notifications = await getNotifications(supabase);

  return (
    <>
      <PageHeader title="Notifications" description="New orders and important system events." />
      <NotificationList notifications={notifications} />
    </>
  );
}
