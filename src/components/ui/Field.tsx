'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
}

/**
 * Labelled form field. Errors are wired through aria-describedby and announced
 * politely, so they reach screen readers rather than relying on colour alone.
 */
export function Field({ label, required, error, hint, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-ink-700">
        {label}
        {required && (
          <span className="text-brand-600 ms-1" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export const inputClass = (hasError?: boolean) =>
  cn(
    'w-full h-12 rounded-xl border bg-white px-4 text-base text-ink-800',
    'placeholder:text-ink-400 transition-colors',
    'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none',
    hasError ? 'border-red-600' : 'border-sand-300',
  );
