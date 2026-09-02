import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { getDashboardStats, getOrders } from '@/lib/data/admin';
import { getActiveEvent } from '@/lib/data/customer';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { TableShell, Td, Th } from '@/components/admin/DataTable';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { supabase } = await requireAdmin();
  const event = await getActiveEvent();

  const [stats, recent] = await Promise.all([
    getDashboardStats(supabase),
    getOrders(supabase, { pageSize: 8 }),
  ]);

  const tiles = [
    { label: 'Total Orders', value: stats.total, tone: 'brand' as const },
    { label: 'New', value: stats.statuses.new, tone: 'amber' as const },
    { label: 'Accepted', value: stats.statuses.accepted, tone: 'plain' as const },
    { label: 'Preparing', value: stats.statuses.preparing, tone: 'plain' as const },
    { label: 'Ready', value: stats.statuses.ready, tone: 'plain' as const },
    { label: 'Completed', value: stats.statuses.completed, tone: 'plain' as const },
    { label: 'Cancelled', value: stats.statuses.cancelled, tone: 'plain' as const },
    { label: 'Customers', value: stats.customers, tone: 'plain' as const },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          event ? `Live overview for ${event.name_en}.` : 'No event is currently active.'
        }
      />

      <section aria-label="Order totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={cn(
              'card-surface p-5',
              tile.tone === 'brand' && 'border-brand-200 bg-brand-50',
              tile.tone === 'amber' && 'border-amber-200 bg-amber-50',
            )}
          >
            <p className="text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">
              {tile.label}
            </p>
            <p className="numeric mt-2 text-3xl font-extrabold text-ink-900">{tile.value}</p>
          </div>
        ))}
      </section>

      <section aria-label="Restaurants" className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="card-surface p-5">
          <p className="text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">Restaurants</p>
          <p className="numeric mt-2 text-3xl font-extrabold text-ink-900">{stats.restaurants}</p>
        </div>
        <div className="card-surface p-5">
          <p className="text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">
            Active Restaurants
          </p>
          <p className="numeric mt-2 text-3xl font-extrabold text-brand-700">
            {stats.activeRestaurants}
          </p>
        </div>
        <div className="card-surface p-5">
          <p className="text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">
            Disabled Restaurants
          </p>
          <p className="numeric mt-2 text-3xl font-extrabold text-ink-500">
            {stats.disabledRestaurants}
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="recent-orders">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="recent-orders" className="text-lg font-extrabold text-ink-900">
            Latest orders
          </h2>
          <Link
            href="/admin/orders"
            className="text-sm font-bold text-brand-700 underline underline-offset-4"
          >
            View all
          </Link>
        </div>

        <TableShell
          isEmpty={recent.orders.length === 0}
          empty={
            <>
              <p className="font-semibold text-ink-800">No orders yet.</p>
              <p className="mt-1 text-sm text-ink-500">
                No orders have been received for this event.
              </p>
            </>
          }
          head={
            <>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Restaurant</Th>
              <Th>Item</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Created</Th>
            </>
          }
        >
          {recent.orders.map((order) => (
            <tr key={order.id} className="transition-colors hover:bg-sand-50">
              <Td>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="numeric font-bold text-brand-700 underline underline-offset-4"
                >
                  {order.order_number}
                </Link>
              </Td>
              <Td className="font-semibold text-ink-800">{order.customers?.name ?? '—'}</Td>
              <Td>{order.restaurants?.name_en ?? '—'}</Td>
              <Td>{order.item_name_en}</Td>
              <Td className="numeric text-right font-semibold">
                SAR {Number(order.unit_price).toFixed(2)}
              </Td>
              <Td>
                <StatusBadge status={order.status} />
              </Td>
              <Td className="numeric whitespace-nowrap text-ink-500">
                {new Date(order.created_at).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Td>
            </tr>
          ))}
        </TableShell>
      </section>
    </>
  );
}
