import { requireAdmin } from '@/lib/auth/admin';
import { Sidebar } from '@/components/admin/Sidebar';
import { ToastProvider } from '@/components/admin/Toaster';
import { RealtimeOrders } from '@/components/admin/RealtimeOrders';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireAdmin();

  const [{ count }, { data: settings }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false),
    supabase.from('app_settings').select('value').eq('key', 'general').maybeSingle(),
  ]);

  const sound = (settings?.value as { sound_notifications?: boolean } | null)?.sound_notifications;

  return (
    <ToastProvider>
      <div className="min-h-dvh lg:pl-64">
        <Sidebar email={user.email ?? ''} unread={count ?? 0} />
        <RealtimeOrders initialUnread={count ?? 0} sound={sound !== false} />
        <div className="px-5 py-6 pt-16 md:px-8 md:py-8 lg:pt-8">{children}</div>
      </div>
    </ToastProvider>
  );
}
