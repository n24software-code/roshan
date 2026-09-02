'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createTranslator, formatPrice, localized } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { orderStore } from '@/lib/selection';
import type { OrderRow, OrderStatus, RestaurantRow } from '@/types/database';
import { StatusTimeline } from './StatusTimeline';
import { OrderQr } from './OrderQr';
import { Alert } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { buttonClass } from '@/components/ui/Button';

type OrderView = OrderRow & { restaurants: Pick<RestaurantRow, 'name_en' | 'name_ar'> | null };

/**
 * Confirmation and live tracking.
 *
 * The order is read with the guest's own session under RLS, so a guessed order
 * number reveals nothing — only the customer who placed it can load it.
 */
export function OrderConfirmation({
  locale,
  orderNumber,
  duplicate,
  customerName,
}: {
  locale: Locale;
  orderNumber: string;
  duplicate: boolean;
  customerName?: string;
}) {
  const t = createTranslator(locale);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(customerName ?? '');

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from('orders')
        .select('*, restaurants(name_en, name_ar)')
        .eq('order_number', orderNumber)
        .maybeSingle();

      if (cancelled) return;

      const row = (data as OrderView | null) ?? null;
      setOrder(row);
      setLoading(false);

      if (!row) return;
      orderStore.set(row.order_number);

      const { data: customer } = await supabase
        .from('customers')
        .select('name')
        .eq('id', row.customer_id)
        .maybeSingle();
      if (!cancelled && customer?.name) setName(customer.name);

      // Live status updates while the guest keeps the page open.
      channel = supabase
        .channel(`order-${row.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${row.id}` },
          (payload) => {
            const next = payload.new as OrderRow;
            setOrder((current) => (current ? { ...current, ...next } : current));
          },
        )
        .subscribe();
    }

    void load();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orderNumber]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-2xl font-extrabold text-ink-900">{t('confirmation.notFound.title')}</h1>
        <p className="text-ink-500">{t('confirmation.notFound.body')}</p>
        <Link href={`/${locale}`} className={buttonClass('primary', 'md')}>
          {t('confirmation.notFound.cta')}
        </Link>
      </div>
    );
  }

  const restaurantName = order.restaurants ? localized(order.restaurants, 'name', locale) : '';
  const itemName = locale === 'ar' ? order.item_name_ar : order.item_name_en;

  return (
    <div className="space-y-8">
      <header className="text-center">
        {duplicate ? (
          <>
            <span
              aria-hidden="true"
              className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-2xl text-amber-700"
            >
              !
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink-900">
              {t('confirmation.duplicateTitle')}
            </h1>
            <p className="mt-2 text-ink-500">{t('confirmation.duplicateBody')}</p>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-100 text-2xl text-brand-700"
            >
              ✓
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink-900">
              {t('confirmation.title')}
            </h1>
            {name && (
              <p className="mt-2 font-semibold text-ink-700">
                {t('confirmation.thanks', { name })}
              </p>
            )}
            <p className="text-ink-500">{t('confirmation.received')}</p>
          </>
        )}
      </header>

      {/* ------------------------------------------------- order number */}
      <div className="card-surface bg-brand-900 px-6 py-7 text-center text-white">
        <p className="text-xs font-semibold tracking-[0.2em] text-brand-200 uppercase">
          {t('confirmation.orderNumber')}
        </p>
        <p className="numeric mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">
          {order.order_number}
        </p>
        <p className="mt-3 text-sm text-brand-100">{t('confirmation.keepNumber')}</p>
      </div>

      {/* ------------------------------------------------------ summary */}
      <dl className="card-surface divide-y divide-sand-200">
        <Row label={t('common.restaurant')} value={restaurantName} />
        <Row label={t('common.item')} value={itemName} />
        <Row
          label={t('common.price')}
          value={formatPrice(Number(order.unit_price), locale)}
          numeric
        />
        <Row label={t('confirmation.status')} value={t(`status.${order.status as OrderStatus}`)} />
      </dl>

      {order.status === 'cancelled' && order.cancel_reason && (
        <Alert tone="error">{order.cancel_reason}</Alert>
      )}

      {/* ------------------------------------------------------- tracking */}
      <section className="card-surface p-6" aria-live="polite">
        <h2 className="text-sm font-bold tracking-[0.14em] text-ink-500 uppercase">
          {t('confirmation.trackTitle')}
        </h2>
        <div className="mt-5">
          <StatusTimeline status={order.status} locale={locale} />
        </div>
      </section>

      <div className="card-surface p-6">
        <OrderQr orderNumber={order.order_number} caption={t('confirmation.showQr')} />
      </div>

      <p className="text-center">
        <Link
          href={`/${locale}`}
          className="text-sm font-semibold text-ink-500 underline underline-offset-4 hover:text-ink-700"
        >
          {t('confirmation.newOrder')}
        </Link>
      </p>
    </div>
  );
}

function Row({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <dt className="text-sm font-semibold text-ink-500">{label}</dt>
      <dd className={`text-end font-bold text-ink-900 ${numeric ? 'numeric' : ''}`}>{value}</dd>
    </div>
  );
}
