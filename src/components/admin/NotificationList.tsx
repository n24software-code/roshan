'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/admin/actions';
import { Button } from '@/components/ui/Button';
import { useToast } from './Toaster';
import { cn } from '@/lib/cn';
import type { NotificationRow } from '@/types/database';

const ICONS: Record<string, string> = {
  'order.created': '🔔',
  'order.cancelled': '✕',
  'restaurant.disabled': '○',
};

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const unread = notifications.filter((entry) => !entry.is_read).length;

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        toast({ title: 'Could not update notifications', body: result.error, tone: 'error' });
        return;
      }
      router.refresh();
    });
  }

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationRead(id);
      router.refresh();
    });
  }

  if (notifications.length === 0) {
    return (
      <div className="card-surface px-6 py-16 text-center">
        <p className="font-semibold text-ink-800">Nothing here yet.</p>
        <p className="mt-1 text-sm text-ink-500">
          New orders, cancellations and restaurant changes appear here in real time.
        </p>
      </div>
    );
  }

  return (
    <>
      {unread > 0 && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" variant="secondary" onClick={markAll} disabled={pending}>
            Mark all as read ({unread})
          </Button>
        </div>
      )}

      <ul className="card-surface divide-y divide-sand-200">
        {notifications.map((entry) => (
          <li
            key={entry.id}
            className={cn('flex items-start gap-4 px-5 py-4', !entry.is_read && 'bg-brand-50/60')}
          >
            <span aria-hidden="true" className="mt-0.5 text-lg">
              {ICONS[entry.type] ?? '•'}
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink-900">
                {entry.title}
                {!entry.is_read && (
                  <span className="ml-2 rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                    New
                  </span>
                )}
              </p>
              {entry.body && <p className="mt-0.5 text-sm text-ink-600">{entry.body}</p>}
              <p className="numeric mt-1 text-xs text-ink-400">
                {new Date(entry.created_at).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {entry.order_id && (
                <Link
                  href={`/admin/orders/${entry.order_id}`}
                  className="rounded-full px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-sand-100"
                >
                  Open order
                </Link>
              )}
              {!entry.is_read && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => markOne(entry.id)}
                >
                  Mark read
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
