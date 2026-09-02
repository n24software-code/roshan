import { NextResponse, type NextRequest } from 'next/server';
import { getAdminContext } from '@/lib/auth/admin';
import { getOrders } from '@/lib/data/admin';

export const dynamic = 'force-dynamic';

/** Escapes a value for CSV, guarding against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const eventId = request.nextUrl.searchParams.get('event') ?? undefined;

  const header = [
    'Order Number',
    'Status',
    'Event',
    'Restaurant',
    'Item',
    'Order Value (SAR)',
    'Customer',
    'Email',
    'Phone',
    'Phone Verified',
    'Created At',
  ];

  const rows: string[] = [header.map(csvCell).join(',')];

  // Paginate so a large event does not have to fit in one query.
  for (let page = 1; ; page += 1) {
    const { orders, pageCount } = await getOrders(context.supabase, {
      eventId,
      page,
      pageSize: 500,
    });

    for (const order of orders) {
      rows.push(
        [
          order.order_number,
          order.status,
          order.events?.name_en ?? '',
          order.restaurants?.name_en ?? '',
          order.item_name_en,
          Number(order.unit_price).toFixed(2),
          order.customers?.name ?? '',
          order.customers?.email ?? '',
          order.customers?.phone ?? '',
          order.customers?.phone_verified ? 'Yes' : 'No',
          order.created_at,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    if (page >= pageCount || orders.length === 0) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(`﻿${rows.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
