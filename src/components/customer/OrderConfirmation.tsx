'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createTranslator, formatPrice, localized } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { getMyOrderStatus } from '@/lib/orders/actions';
import { orderStore } from '@/lib/selection';
import type { OrderPayload, OrderStatus } from '@/types/database';
import { StatusTimeline } from './StatusTimeline';
import { OrderQr } from './OrderQr';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';

/** How often the confirmation screen refreshes the order's status. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Confirmation and live tracking.
 *
 * The order arrives already resolved from the server, where it was read through
 * the verified-phone session rather than a Supabase auth session — so nothing
 * here depends on the browser holding a database session, and an order number
 * typed into the URL by someone else resolves to nothing.
 */
export function OrderConfirmation({
  locale,
  orderNumber,
  duplicate,
  order,
}: {
  locale: Locale;
  orderNumber: string;
  duplicate: boolean;
  order: OrderPayload | null;
}) {
  const t = createTranslator(locale);
  const [status, setStatus] = useState<OrderStatus | null>(order?.status ?? null);

  useEffect(() => {
    if (!order) return;
    orderStore.set(order.order_number);

    let cancelled = false;
    const tick = async () => {
      const latest = await getMyOrderStatus();
      if (!cancelled && latest?.orderNumber === order.order_number) setStatus(latest.status);
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [order]);

  if (!order) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-2xl font-extrabold text-ink-900">{t('confirmation.notFound.title')}</h1>
        <p className="text-ink-500">{t('confirmation.notFound.body')}</p>
        <p className="numeric text-sm text-ink-400">{orderNumber}</p>
        <Link href={`/${locale}`} className={buttonClass('primary', 'md')}>
          {t('confirmation.notFound.cta')}
        </Link>
      </div>
    );
  }

  const currentStatus = status ?? order.status;
  const restaurantName = localized(order.restaurant, 'name', locale);
  const itemName = locale === 'ar' ? order.item.name_ar : order.item.name_en;
  const name = order.customer.name;

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
        <Row label={t('confirmation.status')} value={t(`status.${currentStatus}`)} />
      </dl>

      {currentStatus === 'cancelled' && order.cancel_reason && (
        <Alert tone="error">{order.cancel_reason}</Alert>
      )}

      {/* ------------------------------------------------------- tracking */}
      <section className="card-surface p-6" aria-live="polite">
        <h2 className="text-sm font-bold tracking-[0.14em] text-ink-500 uppercase">
          {t('confirmation.trackTitle')}
        </h2>
        <div className="mt-5">
          <StatusTimeline status={currentStatus} locale={locale} />
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
