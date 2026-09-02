'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from './Toaster';
import type { NotificationRow } from '@/types/database';

/**
 * Live admin notifications.
 *
 * Subscribes to notification inserts, raises a toast, keeps the unread badge in
 * sync and refreshes the current page so tables pick up the new row without a
 * manual reload.
 */
export function RealtimeOrders({
  initialUnread,
  sound,
}: {
  initialUnread: number;
  sound: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Count only what has arrived since mount and add the server's figure, so
  // there is no prop-into-state copy to keep in sync.
  const [received, setReceived] = useState(0);
  const unread = initialUnread + received;
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel('admin-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new as NotificationRow;
          setReceived((count) => count + 1);
          toast({
            title: row.title,
            body: row.body ?? undefined,
            tone: row.type === 'order.created' ? 'success' : 'info',
            href: row.order_id ? `/admin/orders/${row.order_id}` : undefined,
          });
          if (sound && row.type === 'order.created') chime(audioRef);
          router.refresh();
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () =>
        router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, toast, sound]);

  // The badge itself lives in the sidebar; this element only announces changes.
  return (
    <span className="sr-only" aria-live="polite">
      {unread} unread notifications
    </span>
  );
}

/** Short two-note chime, synthesised so no audio asset has to ship. */
function chime(ref: React.RefObject<AudioContext | null>) {
  try {
    ref.current ??= new AudioContext();
    const context = ref.current;
    if (context.state === 'suspended') void context.resume();

    [880, 1174].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.12 + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.12);
      oscillator.stop(context.currentTime + index * 0.12 + 0.25);
    });
  } catch {
    // Autoplay blocked until the admin interacts with the page — not critical.
  }
}
