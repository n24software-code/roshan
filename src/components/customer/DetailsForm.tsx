'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { normalizeSaudiPhone } from '@/lib/phone';
import { customerDetailsSchema } from '@/lib/validation/schemas';
import { placeOrder } from '@/lib/orders/actions';
import { ensureAnonymousSession } from '@/lib/auth/anonymous';
import { getDeviceId } from '@/lib/device';
import { orderStore, selectionStore } from '@/lib/selection';
import { Field, inputClass } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SaudiPhoneInput } from './SaudiPhoneInput';

type FieldErrors = Partial<Record<'name' | 'email' | 'phone', string>>;

/**
 * Collects the guest's details and places the order.
 *
 * Name, email and phone are all required, and none of them is verified — the
 * phone and email exist so the database can enforce one order per person per
 * event. The duplicate decision, the item checks and the total are all made
 * server-side; this form only reports which items were chosen.
 */
export function DetailsForm({
  locale,
  eventSlug,
  restaurantId,
  menuItemIds,
}: {
  locale: Locale;
  eventSlug: string;
  restaurantId: string;
  menuItemIds: string[];
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // The session and device id are normally already in place from the event
  // page; make sure of it here so submitting never has to wait for them.
  useEffect(() => {
    getDeviceId();
    void ensureAnonymousSession();
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = customerDetailsSchema.safeParse({ name, email, phone });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        next[key] ??= t(`errors.${issue.message}`);
      }
      setErrors(next);
      return;
    }
    setErrors({});

    startTransition(async () => {
      await ensureAnonymousSession();

      const result = await placeOrder({
        eventSlug,
        restaurantId,
        menuItemIds,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        deviceId: getDeviceId(),
      });

      if (!result.ok) {
        const message = t(`errors.${result.error}`);
        if (result.error === 'phone_invalid' || result.error === 'phone_required') {
          setErrors({ phone: message });
        } else if (result.error === 'email_invalid') {
          setErrors({ email: message });
        } else if (result.error === 'name_invalid') {
          setErrors({ name: message });
        } else {
          setFormError(message);
        }
        return;
      }

      const { order, result: outcome } = result.data;
      selectionStore.clear();
      orderStore.set(order.order_number);

      // A duplicate is not an error: the guest is shown the order they
      // already have for this event, never a second one.
      const suffix = outcome === 'duplicate' ? '?duplicate=1' : '';
      router.replace(`/${locale}/confirmation/${order.order_number}${suffix}`);
    });
  }

  const normalized = normalizeSaudiPhone(phone);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <Field label={t('details.name')} required error={errors.name}>
        {(props) => (
          <input
            {...props}
            type="text"
            autoComplete="name"
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('details.namePlaceholder')}
            className={inputClass(Boolean(errors.name))}
          />
        )}
      </Field>

      <Field label={t('details.email')} required error={errors.email}>
        {(props) => (
          <input
            {...props}
            type="email"
            dir="ltr"
            autoComplete="email"
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('details.emailPlaceholder')}
            className={`${inputClass(Boolean(errors.email))} text-start`}
          />
        )}
      </Field>

      <Field label={t('details.phone')} required error={errors.phone} hint={t('details.phoneHint')}>
        {(props) => (
          <SaudiPhoneInput
            id={props.id}
            describedBy={props['aria-describedby']}
            value={phone}
            onChange={setPhone}
            disabled={pending}
            hasError={Boolean(errors.phone)}
            countryLabel={t('details.countryCode')}
          />
        )}
      </Field>

      {formError && <Alert tone="error">{formError}</Alert>}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t('details.submitting') : t('details.submit')}
      </Button>

      <p className="text-center text-xs text-ink-500">{t('details.privacy')}</p>

      {/* Announced to screen readers once the number is complete and valid. */}
      <p className="sr-only" aria-live="polite">
        {normalized ? t('details.phone') : ''}
      </p>
    </form>
  );
}
