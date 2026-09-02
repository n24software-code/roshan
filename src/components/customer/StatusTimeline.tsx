import { createTranslator } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/config';
import type { OrderStatus } from '@/types/database';
import { cn } from '@/lib/cn';

/** The happy-path lifecycle shown to the guest. Cancellation is handled apart. */
const TRACK: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'completed'];

export function StatusTimeline({ status, locale }: { status: OrderStatus; locale: Locale }) {
  const t = createTranslator(locale);

  if (status === 'cancelled') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
        <span aria-hidden="true" className="me-2">
          ✕
        </span>
        {t('status.cancelled')}
      </div>
    );
  }

  const currentIndex = TRACK.indexOf(status);

  return (
    <ol className="space-y-0">
      {TRACK.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        const isLast = index === TRACK.length - 1;

        return (
          <li key={step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition-colors',
                  done && 'border-brand-600 bg-brand-600 text-white',
                  current && 'border-brand-600 bg-white text-brand-700',
                  !done && !current && 'border-sand-300 bg-white text-sand-400',
                )}
              >
                {done ? '✓' : current ? '●' : index + 1}
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn('w-0.5 flex-1 min-h-8', done ? 'bg-brand-600' : 'bg-sand-200')}
                />
              )}
            </div>

            <div className={cn('pb-8', isLast && 'pb-0')}>
              <p
                className={cn(
                  'font-semibold',
                  current ? 'text-ink-900' : done ? 'text-ink-700' : 'text-ink-400',
                )}
              >
                {t(`status.${step}`)}
              </p>
              {current && (
                <p className="text-xs font-semibold text-brand-700" aria-live="polite">
                  {t('confirmation.status')}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
