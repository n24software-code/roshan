import Link from 'next/link';
import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth/admin';
import { getDashboardStats, getOrders, ORDER_STATUS_LIST } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatusBadge, ORDER_STATUS_LABELS } from '@/components/admin/StatusBadge';
import { TableShell, Td, Th } from '@/components/admin/DataTable';
import { FilterTabs, Pagination, SearchInput } from '@/components/admin/TableControls';
import { formatSaudiPhone } from '@/lib/phone';
import type { OrderStatus } from '@/types/database';

export const metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { status, q, page } = await searchParams;

  const activeStatus = (ORDER_STATUS_LIST as string[]).includes(status ?? '')
    ? (status as OrderStatus)
    : 'all';

  const [result, stats] = await Promise.all([
    getOrders(supabase, {
      status: activeStatus,
      search: q,
      page: Number(page) || 1,
    }),
    getDashboardStats(supabase),
  ]);

  return (
    <>
      <PageHeader title="Orders" description="Every order received for this event." />

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Suspense fallback={null}>
          <FilterTabs
            param="status"
            options={[
              { value: 'all', label: 'All', count: stats.total },
              ...ORDER_STATUS_LIST.map((value) => ({
                value,
                label: ORDER_STATUS_LABELS[value],
                count: stats.statuses[value],
              })),
            ]}
          />
        </Suspense>
        <Suspense fallback={null}>
          <SearchInput placeholder="Order number, name, phone, email, restaurant" />
        </Suspense>
      </div>

      <TableShell
        isEmpty={result.orders.length === 0}
        empty={
          <>
            <p className="font-semibold text-ink-800">No orders found.</p>
            <p className="mt-1 text-sm text-ink-500">
              {q || activeStatus !== 'all'
                ? 'Try a different filter or search term.'
                : 'No orders have been received for this event.'}
            </p>
          </>
        }
        head={
          <>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th>Phone</Th>
            <Th>Restaurant</Th>
            <Th>Item</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
            <Th>Created</Th>
          </>
        }
      >
        {result.orders.map((order) => (
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
            <Td className="numeric whitespace-nowrap">
              {order.customers ? formatSaudiPhone(order.customers.phone) : '—'}
            </Td>
            <Td>{order.restaurants?.name_en ?? '—'}</Td>
            <Td>
              {order.item_name_en}
              {order.order_items && order.order_items.length > 1 && (
                <span className="text-ink-500"> +{order.order_items.length - 1}</span>
              )}
            </Td>
            <Td className="numeric text-right font-semibold">
              SAR {Number(order.total_price ?? order.unit_price).toFixed(2)}
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

      <Suspense fallback={null}>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} />
      </Suspense>
    </>
  );
}
