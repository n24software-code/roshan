'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { formatSaudiPhone } from '@/lib/phone';
import { submitVerifiedOrder } from '@/lib/orders/actions';
import { checkVerificationStatus, startPhoneVerification } from '@/lib/verification/actions';
import {
  detailsStore,
  orderStore,
  selectionStore,
  useHydrated,
  usePendingDetails,
  useStoredSelection,
} from '@/lib/selection';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const POLL_INTERVAL_MS = 3000;
const RESEND_SECONDS = 30;

type Phase = 'waiting' | 'verified' | 'submitting' | 'expired' | 'failed';

function secondsUntil(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * WhatsApp verification screen.
 *
 * Opening WhatsApp proves nothing on its own: the screen simply polls the
 * server, and the server only reports "verified" once the inbound message has
 * actually arrived at the webhook from this number. Once that happens the
 * pending selection is submitted in the same visit.
 */
export function VerifyFlow({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const ready = useHydrated();
  const details = usePendingDetails();
  const selection = useStoredSelection();

  const [phase, setPhase] = useState<Phase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [opened, setOpened] = useState(false);
  const submittedRef = useRef(false);

  // ---- countdowns -------------------------------------------------------
  // One ticking clock; both counters are derived from it, so nothing has to be
  // re-synchronised when the pending request is replaced by a fresh one.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = secondsUntil(details?.expiresAt, now);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // A code that has run out of time is expired whether or not the server has
  // been asked yet.
  const currentPhase: Phase = phase === 'waiting' && secondsLeft <= 0 ? 'expired' : phase;

  // ---- the order, placed as soon as the number is verified --------------
  function placeOrder() {
    if (!selection || submittedRef.current) return;
    submittedRef.current = true;
    setPhase('submitting');

    startTransition(async () => {
      const result = await submitVerifiedOrder({
        eventSlug: selection.eventSlug,
        restaurantId: selection.restaurantId,
        menuItemId: selection.menuItemId,
      });

      if (!result.ok) {
        submittedRef.current = false;
        setPhase('verified');
        setError(t(`errors.${result.error}`));
        return;
      }

      const { order, result: outcome } = result.data;
      detailsStore.clear();
      selectionStore.clear();
      orderStore.set(order.order_number);
      router.replace(
        `/${locale}/confirmation/${order.order_number}${outcome === 'duplicate' ? '?duplicate=1' : ''}`,
      );
    });
  }

  // ---- status polling ---------------------------------------------------
  useEffect(() => {
    if (!details) return;
    if (currentPhase !== 'waiting') return;

    let cancelled = false;

    async function poll() {
      const state = await checkVerificationStatus();
      if (cancelled) return;

      // Verified and already holding an order for this event: nothing left to
      // do but show it. `order` is only ever present on a verified session.
      if (state.order) {
        detailsStore.clear();
        selectionStore.clear();
        orderStore.set(state.order.order_number);
        router.replace(`/${locale}/confirmation/${state.order.order_number}?duplicate=1`);
        return;
      }

      if (state.status === 'verified') setPhase('verified');
      else if (state.status === 'expired' || state.status === 'none') setPhase('expired');
      else if (state.status === 'failed') setPhase('failed');
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [details, currentPhase, locale, router]);

  // Verified with a selection waiting: submit it without a second click. The
  // submitter is reached through a ref so this effect depends only on the facts
  // that should re-trigger it, not on the identity of a closure.
  const placeOrderRef = useRef(placeOrder);
  useEffect(() => {
    placeOrderRef.current = placeOrder;
  });

  useEffect(() => {
    if (currentPhase === 'verified' && selection && !submittedRef.current && !error) {
      placeOrderRef.current();
    }
  }, [currentPhase, selection, error]);

  // ---- resend -----------------------------------------------------------
  function resend() {
    if (!details || !selection || resendIn > 0 || pending) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await startPhoneVerification({
        eventSlug: selection.eventSlug,
        name: details.name,
        phone: details.phone,
      });

      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }

      detailsStore.set({
        name: details.name,
        phone: details.phone,
        menuItemId: details.menuItemId,
        expiresAt: result.data.expiresAt,
        whatsappUrl: result.data.whatsappUrl,
        developmentMessage: result.data.developmentMessage,
      });
      submittedRef.current = false;
      setPhase('waiting');
      setResendIn(RESEND_SECONDS);
      setOpened(false);
      setNotice(t('verify.resent'));
    });
  }

  /** Development only: replays the WhatsApp message through the real webhook. */
  function simulate() {
    const message = details?.developmentMessage;
    if (!message) return;
    setError(null);

    startTransition(async () => {
      try {
        await fetch('/api/verification/whatsapp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        });
        setNotice(t('verify.simulated'));
      } catch {
        setError(t('errors.network'));
      }
    });
  }

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // Landed here without a pending verification — restart the flow.
  if (!details || !selection) {
    return (
      <div className="space-y-5 text-center">
        <h1 className="text-2xl font-extrabold text-ink-900">{t('selection.empty.title')}</h1>
        <p className="text-ink-500">{t('selection.empty.body')}</p>
        <Link href={`/${locale}`} className="inline-block">
          <Button size="lg">{t('selection.empty.cta')}</Button>
        </Link>
      </div>
    );
  }

  const statusLabel =
    currentPhase === 'verified' || currentPhase === 'submitting'
      ? t('verify.statusVerified')
      : currentPhase === 'expired'
        ? t('verify.statusExpired')
        : currentPhase === 'failed'
          ? t('verify.statusFailed')
          : t('verify.statusWaiting');

  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 md:text-4xl">
          {t('verify.title')}
        </h1>
        <p className="mt-3 text-ink-500">{t('verify.subtitle')}</p>
        <p className="numeric mt-1 text-lg font-bold text-ink-900" dir="ltr">
          {formatSaudiPhone(details.phone)}
        </p>
      </header>

      {/* --------------------------------------------------------- status */}
      <div className="card-surface flex items-center justify-between gap-4 bg-sand-50 px-5 py-4">
        <span className="text-sm font-semibold text-ink-500">{t('verify.statusLabel')}</span>
        <span
          aria-live="polite"
          className={`text-sm font-bold ${
            currentPhase === 'verified' || currentPhase === 'submitting'
              ? 'text-brand-700'
              : currentPhase === 'waiting'
                ? 'text-ink-700'
                : 'text-red-700'
          }`}
        >
          {currentPhase === 'waiting' && (
            <span
              aria-hidden="true"
              className="me-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-600 align-middle"
            />
          )}
          {statusLabel}
        </span>
      </div>

      {notice && !error && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {currentPhase === 'expired' && <Alert tone="error">{t('errors.verification_expired')}</Alert>}
      {currentPhase === 'failed' && <Alert tone="error">{t('errors.verification_failed')}</Alert>}

      {/* ------------------------------------------------ WhatsApp handoff */}
      {currentPhase === 'waiting' && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-600">
            <li>{t('verify.step1')}</li>
            <li>{t('verify.step2')}</li>
            <li>{t('verify.step3')}</li>
          </ol>

          {details.whatsappUrl ? (
            <a
              href={details.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
              className={buttonClass('primary', 'lg', 'w-full')}
            >
              {t('verify.openWhatsapp')}
            </a>
          ) : (
            <Alert tone="warning">{t('errors.verification_not_configured')}</Alert>
          )}

          {opened && <p className="text-center text-sm text-ink-500">{t('verify.afterSending')}</p>}

          <p className="numeric text-center text-sm font-semibold text-ink-400" aria-live="off">
            {t('verify.expiresIn', { time: clock(secondsLeft) })}
          </p>

          {details.developmentMessage && (
            <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4">
              <p className="text-xs font-bold tracking-[0.14em] text-amber-800 uppercase">
                {t('verify.devTitle')}
              </p>
              <p className="mt-1 text-sm text-amber-900">{t('verify.devBody')}</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3 w-full"
                disabled={pending}
                onClick={simulate}
              >
                {t('verify.devButton')}
              </Button>
            </div>
          )}
        </div>
      )}

      {(currentPhase === 'verified' || currentPhase === 'submitting') &&
        (error ? (
          // The number is verified but the order did not go through — let the
          // guest retry without verifying again.
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => {
              setError(null);
              placeOrderRef.current();
            }}
          >
            {t('verify.retryOrder')}
          </Button>
        ) : (
          <p className="text-center font-semibold text-ink-700" aria-live="polite">
            {t('verify.creatingOrder')}
          </p>
        ))}

      {/* --------------------------------------------------------- resend */}
      {(currentPhase === 'waiting' || currentPhase === 'expired' || currentPhase === 'failed') && (
        <div className="space-y-2 text-center text-sm">
          <p className="text-ink-500">{t('verify.noMessage')}</p>
          {resendIn > 0 ? (
            <p className="numeric font-semibold text-ink-400" aria-live="polite">
              {t('verify.resendIn', { seconds: resendIn })}
            </p>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={pending}
              className="font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800 disabled:text-ink-400"
            >
              {t('verify.resend')}
            </button>
          )}
        </div>
      )}

      <p className="text-center">
        <Link
          href={`/${locale}/order?item=${selection.menuItemId}`}
          className="text-sm font-semibold text-ink-500 underline underline-offset-4 hover:text-ink-700"
        >
          {t('verify.changeNumber')}
        </Link>
      </p>
    </div>
  );
}
