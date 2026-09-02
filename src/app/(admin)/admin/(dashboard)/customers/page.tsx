import Link from 'next/link';
import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth/admin';
import { getCustomers, getDuplicateAttempts } from '@/lib/data/admin';
import { PageHeader } from '@/components/admin/PageHeader';
import { TableShell, Td, Th } from '@/components/admin/DataTable';
import { Pagination, SearchInput } from '@/components/admin/TableControls';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { formatSaudiPhone } from '@/lib/phone';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { q, page } = await searchParams;

  const result = await getCustomers(supabase, { search: q, page: Number(page) || 1 });
  const duplicateAttempts = await getDuplicateAttempts(
    supabase,
    result.customers.map((customer) => customer.id),
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Each verified mobile number can place one order per event."
      />

      <div className="mb-5 flex justify-end">
        <Suspense fallback={null}>
          <SearchInput placeholder="Name, email or phone" />
        </Suspense>
      </div>

      <TableShell
        isEmpty={result.customers.length === 0}
        empty={
          <>
            <p className="font-semibold text-ink-800">No customers found.</p>
            <p className="mt-1 text-sm text-ink-500">
              Customer records are created once a mobile number is verified.
            </p>
          </>
        }
        head={
          <>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Phone</Th>
            <Th>Phone Verified</Th>
            <Th>Orders</Th>
            <Th>Duplicate Attempts</Th>
            <Th>Created At</Th>
          </>
        }
      >
        {result.customers.map((customer) => (
          <tr key={customer.id} className="hover:bg-sand-50">
            <Td className="font-semibold text-ink-900">{customer.name}</Td>
            <Td>
              <a
                href={`mailto:${customer.email}`}
                className="text-brand-700 underline underline-offset-4"
              >
                {customer.email}
              </a>
            </Td>
            <Td className="numeric whitespace-nowrap">{formatSaudiPhone(customer.phone)}</Td>
            <Td>
              {customer.phone_verified ? (
                <span className="font-semibold text-brand-700">✓ Verified</span>
              ) : (
                <span className="font-semibold text-ink-500">✕ Not verified</span>
              )}
            </Td>
            <Td>
              {customer.orders.length === 0 ? (
                <span className="text-ink-400">No orders</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {customer.orders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-2 rounded-full border border-sand-300 bg-white px-2.5 py-1 text-xs font-bold whitespace-nowrap hover:bg-sand-100"
                    >
                      <span className="numeric text-brand-700">{order.order_number}</span>
                      <StatusBadge
                        status={order.status}
                        className="border-0 bg-transparent px-0 py-0"
                      />
                    </Link>
                  ))}
                </div>
              )}
            </Td>
            <Td>
              {(duplicateAttempts.get(customer.id) ?? 0) > 0 ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold whitespace-nowrap text-amber-900"
                  title="Existing order found for this phone number — no second order was created."
                >
                  <span aria-hidden="true">!</span>
                  {duplicateAttempts.get(customer.id)} blocked
                </span>
              ) : (
                <span className="text-ink-400">—</span>
              )}
            </Td>
            <Td className="numeric whitespace-nowrap text-ink-500">
              {new Date(customer.created_at).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
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
