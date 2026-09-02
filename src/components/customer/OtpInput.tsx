'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

const LENGTH = 6;
const BLANK = ' '.repeat(LENGTH);

/** Removes the blank placeholders, leaving just the digits entered so far. */
export function otpDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Six digit boxes that behave like one field: typing advances, backspace
 * retreats, and pasting a code fills every box at once.
 *
 * `value` is always exactly six characters, using spaces for empty boxes, so a
 * digit typed into box 4 stays in box 4.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  hasError,
  label,
  digitLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  label: string;
  digitLabel: (index: number) => string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const boxes = (value + BLANK).slice(0, LENGTH).split('');

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function commit(next: string[], focusIndex: number) {
    const joined = next.join('');
    onChange(joined);
    refs.current[Math.min(Math.max(focusIndex, 0), LENGTH - 1)]?.focus();

    const digits = otpDigits(joined);
    if (digits.length === LENGTH) onComplete?.(digits);
  }

  function handleChange(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    const next = [...boxes];

    if (!typed) {
      next[index] = ' ';
      commit(next, index);
      return;
    }

    // Pasted or fast-typed input spills into the following boxes.
    for (let offset = 0; offset < typed.length && index + offset < LENGTH; offset += 1) {
      next[index + offset] = typed[offset];
    }
    commit(next, index + typed.length);
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    const next = [...boxes];

    if (event.key === 'Backspace') {
      event.preventDefault();
      if (next[index] !== ' ') {
        next[index] = ' ';
        commit(next, index);
      } else if (index > 0) {
        next[index - 1] = ' ';
        commit(next, index - 1);
      }
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  return (
    <div dir="ltr" role="group" aria-label={label} className="flex justify-center gap-2 sm:gap-3">
      {boxes.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={LENGTH}
          disabled={disabled}
          aria-label={digitLabel(index + 1)}
          aria-invalid={hasError || undefined}
          value={digit.trim()}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(
            'numeric h-14 w-11 rounded-xl border bg-white text-center text-xl font-bold text-ink-900 sm:h-16 sm:w-13 sm:text-2xl',
            'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none',
            'disabled:bg-sand-100 disabled:text-ink-500',
            hasError ? 'border-red-600' : 'border-sand-300',
          )}
        />
      ))}
    </div>
  );
}

export const OTP_BLANK = BLANK;
