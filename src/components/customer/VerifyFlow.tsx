'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { maskSaudiPhone } from '@/lib/phone';
import { sendVerificationCode, verifyAndPlaceOrder } from '@/lib/orders/actions';
import {
  detailsStore,
  orderStore,
  selectionStore,
  useHydrated,
  usePendingDetails,
  useStoredSelection,
} from '@/lib/selection';
import { OtpInput, OTP_BLANK, otpDigits } from './OtpInput';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const RESEND_SECONDS = 30;

/**
 * Verification screen. On success the order is created in the same server round
 * trip, so a verified guest can never end up verified-but-order-less.
 */
export function VerifyFlow({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The in-progress flow is read straight from storage; without it there is
  // nothing to verify and the guest is sent back to browsing.
  const ready = useHydrated();
  const details = usePendingDetails();
  const selection = useStoredSelection();

  const [code, setCode] = useState(OTP_BLANK);
  const [error, setError] = useState<string | null>(null);
  const [resentNotice, setResentNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const submittedRef = useRef(false);

  // Confirms the code that the details screen already sent, until a resend
  // replaces the message with a fresh one.
  const notice =
    resentNotice ?? (details ? t('otp.sent', { phone: maskSaudiPhone(details.phone) }) : null);

  // Resend countdown.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Plain function: the React Compiler memoizes it, and a manual useCallback
  // here only fought with the inferred dependencies.
  function submit(rawCode: string) {
    if (!details || !selection) return;
    if (submittedRef.current) return; // guard against double submission

    const digits = otpDigits(rawCode);
    if (digits.length !== 6) {
      setError(t('errors.otp_invalid'));
      return;
    }

    submittedRef.current = true;
    setError(null);

    startTransition(async () => {
      const result = await verifyAndPlaceOrder({
        phone: details.phone,
        code: digits,
        eventSlug: selection.eventSlug,
        restaurantId: selection.restaurantId,
        menuItemId: selection.menuItemId,
        name: details.name,
        email: details.email,
      });

      if (!result.ok) {
        submittedRef.current = false;
        setError(t(`errors.${result.error}`));
        setCode(OTP_BLANK);
        return;
      }

      const { order, result: outcome } = result.data;
      detailsStore.clear();
      selectionStore.clear();
      orderStore.set(order.order_number);

      const suffix = outcome === 'duplicate' ? '?duplicate=1' : '';
      router.replace(`/${locale}/confirmation/${order.order_number}${suffix}`);
    });
  }

  function resend() {
    if (!details || secondsLeft > 0 || pending) return;
    setError(null);

    startTransition(async () => {
      const result = await sendVerificationCode({
        name: details.name,
        email: details.email,
        phone: details.phone,
      });

      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      setSecondsLeft(RESEND_SECONDS);
      setCode(OTP_BLANK);
      setResentNotice(t('otp.sent', { phone: maskSaudiPhone(details.phone) }));
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

  // The guest landed here without a pending verification — restart the flow.
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

  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 md:text-4xl">
          {t('otp.title')}
        </h1>
        <p className="mt-3 text-ink-500">{t('otp.subtitle')}</p>
        <p className="numeric mt-1 text-lg font-bold text-ink-900">
          {maskSaudiPhone(details.phone)}
        </p>
      </header>

      {notice && !error && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={submit}
        disabled={pending}
        hasError={Boolean(error)}
        label={t('otp.codeLabel')}
        digitLabel={(index) => t('otp.digitLabel', { index })}
      />

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={pending || otpDigits(code).length !== 6}
        onClick={() => submit(code)}
      >
        {pending ? t('otp.creatingOrder') : t('otp.verify')}
      </Button>

      <div className="space-y-2 text-center text-sm">
        <p className="text-ink-500">{t('otp.noCode')}</p>
        {secondsLeft > 0 ? (
          <p className="numeric font-semibold text-ink-400" aria-live="polite">
            {t('otp.resendIn', { seconds: secondsLeft })}
          </p>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={pending}
            className="font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800 disabled:text-ink-400"
          >
            {t('otp.resend')}
          </button>
        )}
      </div>

      <p className="text-center">
        <Link
          href={`/${locale}/order?item=${selection.menuItemId}`}
          className="text-sm font-semibold text-ink-500 underline underline-offset-4 hover:text-ink-700"
        >
          {t('otp.changeNumber')}
        </Link>
      </p>
    </div>
  );
}
