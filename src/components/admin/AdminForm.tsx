'use client';

import { cn } from '@/lib/cn';

/** Shared field chrome for the admin CRUD dialogs. */
export function FormRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink-700">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-brand-600">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const adminInput =
  'w-full h-10 rounded-lg border border-sand-300 bg-white px-3 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none';

export const adminTextarea =
  'w-full min-h-20 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none';

export const adminSelect = adminInput;

/** Accessible on/off switch backed by a real checkbox. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <span className="relative inline-flex">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'block h-6 w-11 rounded-full transition-colors',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500',
            checked ? 'bg-brand-600' : 'bg-sand-300',
            disabled && 'opacity-50',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </span>
      <span className="text-sm font-semibold text-ink-700">{label}</span>
    </label>
  );
}
