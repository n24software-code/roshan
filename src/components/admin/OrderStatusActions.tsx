'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { updateOrderStatus } from '@/lib/admin/actions';
import { ALLOWED_TRANSITIONS } from '@/lib/admin/transitions';
import { ORDER_STATUS_LABELS } from './StatusBadge';
import { Modal } from './Modal';
import { useToast } from './Toaster';
import { Button } from '@/components/ui/Button';
import { adminTextarea } from './AdminForm';
import type { OrderStatus } from '@/types/database';

/**
 * Status controls. Only transitions the workflow actually allows are offered,
 * and the server re-checks the same rule before writing.
 */
export function OrderStatusActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const next = ALLOWED_TRANSITIONS[status] ?? [];
  const forward = next.filter((value) => value !== 'cancelled');
  const canCancel = next.includes('cancelled');

  function apply(target: OrderStatus, cancelReason?: string | null) {
    startTransition(async () => {
      const result = await updateOrderStatus({ orderId, status: target, reason: cancelReason });
      if (!result.ok) {
        toast({ title: 'Could not update the order', body: result.error, tone: 'error' });
        return;
      }
      toast({
        title: `Order marked ${ORDER_STATUS_LABELS[target].toLowerCase()}`,
        tone: 'success',
      });
      setCancelOpen(false);
      setReason('');
      router.refresh();
    });
  }

  if (next.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        This order is {ORDER_STATUS_LABELS[status].toLowerCase()} — no further changes are possible.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {forward.map((target) => (
          <Button
            key={target}
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => apply(target)}
          >
            {target === 'accepted' ? 'Accept' : `Mark ${ORDER_STATUS_LABELS[target]}`}
          </Button>
        ))}
        {canCancel && (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => setCancelOpen(true)}
          >
            Cancel order
          </Button>
        )}
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => apply('cancelled', reason.trim() || null)}
            >
              {pending ? 'Cancelling...' : 'Cancel order'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          The order stays in history and in reports. The guest sees the cancellation on their order
          page.
        </p>
        <label htmlFor="cancel-reason" className="mt-4 block text-sm font-semibold text-ink-700">
          Reason (optional)
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          className={`${adminTextarea} mt-1.5`}
          placeholder="Shown to the guest on their order page"
        />
      </Modal>
    </>
  );
}
