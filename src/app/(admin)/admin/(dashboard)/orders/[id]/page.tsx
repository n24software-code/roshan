import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { getOrder, getOrderHistory } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatusBadge, ORDER_STATUS_LABELS } from '@/components/admin/StatusBadge';
import { OrderStatusActions } from '@/components/admin/OrderStatusActions';
import { formatSaudiPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const order = await getOrder(supabase, id);
  return { title: order ? `Order ${order.order_number}` : 'Order' };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const order = await getOrder(supabase, id);
  if (!order) notFound();

  const history = await getOrderHistory(supabase, order.id);

  // Orders placed before order_items existed fall back to their own snapshot.
  const lines =
    order.order_items && order.order_items.length > 0
      ? [...order.order_items].sort((a, b) => Number(b.unit_price) - Number(a.unit_price))
      : [
          {
            id: order.id,
            item_name_en: order.item_name_en,
            unit_price: order.unit_price,
          },
        ];

  const details: { label: string; value: React.ReactNode }[] = [
    { label: 'Customer', value: order.customers?.name ?? '—' },
    {
      label: 'Email',
      value: order.customers ? (
        <a
          href={`mailto:${order.customers.email}`}
          className="text-brand-700 underline underline-offset-4"
        >
          {order.customers.email}
        </a>
      ) : (
        '—'
      ),
    },
    {
      label: 'Phone',
      value: (
        <span className="numeric">
          {order.customers ? formatSaudiPhone(order.customers.phone) : '—'}
        </span>
      ),
    },
    { label: 'Event', value: order.events?.name_en ?? '—' },
    { label: 'Restaurant', value: order.restaurants?.name_en ?? '—' },
    {
      label: 'Total',
      value: (
        <span className="numeric">
          SAR {Number(order.total_price ?? order.unit_price).toFixed(2)}
        </span>
      ),
    },
    {
      label: 'Order Created',
      value: (
        <span className="numeric">
          {new Date(order.created_at).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
  ];

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-ink-500 hover:text-brand-700"
      >
        <span aria-hidden="true">←</span> All orders
      </Link>

      <PageHeader
        title={`Order ${order.order_number}`}
        actions={<StatusBadge status={order.status} className="text-sm" />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card-surface lg:col-span-2" aria-label="Order details">
          <dl className="divide-y divide-sand-200">
            {details.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-6 px-5 py-3.5">
                <dt className="text-sm font-semibold text-ink-500">{row.label}</dt>
                <dd className="text-right text-sm font-semibold text-ink-900">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-sand-200 px-5 py-4">
            <p className="mb-3 text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">Items</p>
            <ul className="space-y-2">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold text-ink-800">{line.item_name_en}</span>
                  <span className="numeric shrink-0 font-semibold text-ink-900">
                    SAR {Number(line.unit_price).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {order.cancel_reason && (
            <div className="border-t border-sand-200 bg-red-50 px-5 py-4">
              <p className="text-xs font-bold tracking-[0.1em] text-red-800 uppercase">
                Cancellation reason
              </p>
              <p className="mt-1 text-sm text-red-900">{order.cancel_reason}</p>
            </div>
          )}

          <div className="border-t border-sand-200 bg-sand-50 px-5 py-4">
            <p className="mb-3 text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">
              Actions
            </p>
            <OrderStatusActions orderId={order.id} status={order.status} />
          </div>
        </section>

        <section className="card-surface p-5" aria-labelledby="history-heading">
          <h2
            id="history-heading"
            className="text-sm font-bold tracking-[0.1em] text-ink-500 uppercase"
          >
            Status history
          </h2>

          <ol className="mt-4 space-y-4">
            {history.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                />
                <div>
                  <p className="text-sm font-semibold text-ink-800">
                    {ORDER_STATUS_LABELS[entry.to_status]}
                    {entry.from_status && (
                      <span className="font-normal text-ink-500">
                        {' '}
                        from {ORDER_STATUS_LABELS[entry.from_status]}
                      </span>
                    )}
                  </p>
                  <p className="numeric text-xs text-ink-500">
                    {new Date(entry.created_at).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {entry.note && <p className="mt-0.5 text-xs text-ink-500">{entry.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
