import { requireAdmin } from '@/lib/auth/admin';
import { getEvents, getReport, ORDER_STATUS_LIST } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { TableShell, Td, Th } from '@/components/admin/DataTable';
import { ORDER_STATUS_LABELS } from '@/components/admin/StatusBadge';
import { buttonClass } from '@/components/ui/Button';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { event: eventId } = await searchParams;

  const [events, report] = await Promise.all([getEvents(supabase), getReport(supabase, eventId)]);

  const tiles = [
    { label: 'Total Orders', value: report.totalOrders },
    { label: 'Completed Orders', value: report.byStatus.completed },
    { label: 'Cancelled Orders', value: report.byStatus.cancelled },
    { label: 'Unique Customers', value: report.uniqueCustomers },
  ];

  const exportHref = `/api/admin/reports/export${eventId ? `?event=${eventId}` : ''}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Order counts and estimated order value. This platform takes no payments, so these figures are not revenue."
        actions={
          <a href={exportHref} className={buttonClass('secondary', 'sm')} download>
            Export CSV
          </a>
        }
      />

      {/* --------------------------------------------------- event filter */}
      <form className="card-surface mb-6 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="report-event" className="block text-sm font-semibold text-ink-700">
            Event
          </label>
          <select
            id="report-event"
            name="event"
            defaultValue={eventId ?? ''}
            className="mt-1.5 h-10 w-full rounded-lg border border-sand-300 bg-white px-3 text-sm"
          >
            <option value="">All events</option>
            {events.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name_en}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass('primary', 'sm')}>
          Apply
        </button>
      </form>

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="card-surface p-5">
            <p className="text-xs font-bold tracking-[0.1em] text-ink-500 uppercase">
              {tile.label}
            </p>
            <p className="numeric mt-2 text-3xl font-extrabold text-ink-900">{tile.value}</p>
          </div>
        ))}
        <div className="card-surface border-brand-200 bg-brand-50 p-5">
          <p className="text-xs font-bold tracking-[0.1em] text-brand-800 uppercase">
            Estimated Order Value
          </p>
          <p className="numeric mt-2 text-3xl font-extrabold text-brand-900">
            SAR {report.estimatedOrderValue.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-brand-800/80">Excludes cancelled orders.</p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="by-status">
        <h2 id="by-status" className="mb-3 text-lg font-extrabold text-ink-900">
          Orders by status
        </h2>
        <TableShell
          isEmpty={report.totalOrders === 0}
          empty={<p className="text-sm text-ink-500">No orders to report yet.</p>}
          head={
            <>
              <Th>Status</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Share</Th>
            </>
          }
        >
          {ORDER_STATUS_LIST.map((status) => (
            <tr key={status} className="hover:bg-sand-50">
              <Td className="font-semibold text-ink-900">{ORDER_STATUS_LABELS[status]}</Td>
              <Td className="numeric text-right">{report.byStatus[status]}</Td>
              <Td className="numeric text-right text-ink-500">
                {report.totalOrders
                  ? `${((report.byStatus[status] / report.totalOrders) * 100).toFixed(1)}%`
                  : '—'}
              </Td>
            </tr>
          ))}
        </TableShell>
      </section>

      <section className="mt-10" aria-labelledby="by-restaurant">
        <h2 id="by-restaurant" className="mb-3 text-lg font-extrabold text-ink-900">
          Restaurant performance
        </h2>
        <TableShell
          isEmpty={report.byRestaurant.length === 0}
          empty={<p className="text-sm text-ink-500">No orders to report yet.</p>}
          head={
            <>
              <Th>Restaurant</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Order Value</Th>
            </>
          }
        >
          {report.byRestaurant.map((row) => (
            <tr key={row.name} className="hover:bg-sand-50">
              <Td className="font-semibold text-ink-900">{row.name}</Td>
              <Td className="numeric text-right">{row.orders}</Td>
              <Td className="numeric text-right">SAR {row.value.toFixed(2)}</Td>
            </tr>
          ))}
        </TableShell>
      </section>

      <section className="mt-10" aria-labelledby="by-item">
        <h2 id="by-item" className="mb-3 text-lg font-extrabold text-ink-900">
          Most ordered items
        </h2>
        <TableShell
          isEmpty={report.byItem.length === 0}
          empty={<p className="text-sm text-ink-500">No orders to report yet.</p>}
          head={
            <>
              <Th>Item</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Order Value</Th>
            </>
          }
        >
          {report.byItem.slice(0, 25).map((row) => (
            <tr key={row.name} className="hover:bg-sand-50">
              <Td className="font-semibold text-ink-900">{row.name}</Td>
              <Td className="numeric text-right">{row.orders}</Td>
              <Td className="numeric text-right">SAR {row.value.toFixed(2)}</Td>
            </tr>
          ))}
        </TableShell>
      </section>
    </>
  );
}
