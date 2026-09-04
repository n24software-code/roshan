'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import { normalizeSaudiPhone } from '@/lib/phone';
import { attendeeDetailsSchema } from '@/lib/validation/schemas';
import { startPhoneVerification } from '@/lib/verification/actions';
import { detailsStore, selectionStore } from '@/lib/selection';
import { Field, inputClass } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SaudiPhoneInput } from './SaudiPhoneInput';

type FieldErrors = Partial<Record<'name' | 'phone', string>>;

/**
 * Collects the attendee's name and number and opens a verification request.
 *
 * Nothing is persisted against the guest here beyond the pending verification
 * row — the customer record is only created once the number has actually been
 * verified through WhatsApp.
 */
export function DetailsForm({
  locale,
  eventSlug,
  restaurantId,
  menuItemId,
  restaurantSlug,
}: {
  locale: Locale;
  eventSlug: string;
  restaurantId: string;
  menuItemId: string;
  restaurantSlug: string;
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = attendeeDetailsSchema.safeParse({ name, phone });
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
      const result = await startPhoneVerification({ ...parsed.data, eventSlug });

      if (!result.ok) {
        const message = t(`errors.${result.error}`);
        if (result.error === 'phone_invalid' || result.error === 'phone_required') {
          setErrors({ phone: message });
        } else {
          setFormError(message);
        }
        return;
      }

      // Hand the flow to the verification screen.
      selectionStore.set({ eventSlug, restaurantSlug, restaurantId, menuItemId });
      detailsStore.set({
        name: parsed.data.name,
        phone: parsed.data.phone,
        menuItemId,
        expiresAt: result.data.expiresAt,
        whatsappUrl: result.data.whatsappUrl,
        developmentMessage: result.data.developmentMessage,
      });
      router.push(`/${locale}/verify`);
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
