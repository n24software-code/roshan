import { cn } from '@/lib/cn';

type Tone = 'error' | 'success' | 'info' | 'warning';

const TONES: Record<Tone, { box: string; icon: string }> = {
  error: { box: 'bg-red-50 border-red-200 text-red-900', icon: '⚠' },
  success: { box: 'bg-brand-50 border-brand-200 text-brand-900', icon: '✓' },
  info: { box: 'bg-sand-100 border-sand-300 text-ink-800', icon: 'ℹ' },
  warning: { box: 'bg-amber-50 border-amber-200 text-amber-900', icon: '!' },
};

/** Status message. Carries an icon and text so meaning never depends on colour. */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const style = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', style.box, className)}
    >
      <span aria-hidden="true" className="mt-0.5 font-bold">
        {style.icon}
      </span>
      <div className="space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
