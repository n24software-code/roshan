'use client';

import { formatNationalInput } from '@/lib/phone';
import { cn } from '@/lib/cn';

/**
 * Saudi-only mobile input. The country is fixed to +966 and cannot be changed,
 * so no international number can be entered; the guest types the 9-digit
 * national part and it is grouped as "5X XXX XXXX" while they type.
 */
export function SaudiPhoneInput({
  value,
  onChange,
  countryLabel,
  hasError,
  id,
  describedBy,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  countryLabel: string;
  hasError?: boolean;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <div
      dir="ltr"
      className={cn(
        'flex h-12 w-full overflow-hidden rounded-xl border bg-white transition-colors',
        'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
        hasError ? 'border-red-600' : 'border-sand-300',
        disabled && 'opacity-60',
      )}
    >
      <span
        className="flex shrink-0 items-center gap-2 border-e border-sand-200 bg-sand-100 px-3 text-sm font-semibold text-ink-700"
        aria-label={countryLabel}
        title={countryLabel}
      >
        <span aria-hidden="true">🇸🇦</span>
        <span className="numeric">+966</span>
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        dir="ltr"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(formatNationalInput(event.target.value))}
        placeholder="5X XXX XXXX"
        maxLength={12}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className="numeric min-w-0 flex-1 bg-transparent px-3 text-base tracking-wide text-ink-800 placeholder:tracking-normal placeholder:text-ink-400 focus:outline-none"
      />
    </div>
  );
}
