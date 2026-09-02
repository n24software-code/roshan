import type { OrderStatus } from '@/types/database';
import { cn } from '@/lib/cn';

/** Status pill. Every state carries a distinct glyph as well as a colour. */
const STYLES: Record<OrderStatus, { label: string; className: string; icon: string }> = {
  new: { label: 'New', className: 'bg-amber-100 text-amber-900 border-amber-200', icon: '●' },
  accepted: { label: 'Accepted', className: 'bg-sky-100 text-sky-900 border-sky-200', icon: '✓' },
  preparing: {
    label: 'Preparing',
    className: 'bg-indigo-100 text-indigo-900 border-indigo-200',
    icon: '◐',
  },
  ready: { label: 'Ready', className: 'bg-brand-100 text-brand-900 border-brand-200', icon: '▲' },
  completed: {
    label: 'Completed',
    className: 'bg-sand-200 text-ink-700 border-sand-300',
    icon: '✔',
  },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-900 border-red-200', icon: '✕' },
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const style = STYLES[status] ?? STYLES.new;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap',
        style.className,
        className,
      )}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = Object.fromEntries(
  Object.entries(STYLES).map(([key, value]) => [key, value.label]),
) as Record<OrderStatus, string>;
