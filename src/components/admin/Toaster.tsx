'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  href?: string;
}

interface ToastApi {
  toast: (input: Omit<Toast, 'id'> | string) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const TONES: Record<ToastTone, string> = {
  success: 'border-brand-200 bg-brand-50 text-brand-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-sand-300 bg-white text-ink-800',
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'> | string) => {
      const payload = typeof input === 'string' ? { title: input, tone: 'info' as const } : input;
      const id = (nextId += 1);
      setToasts((current) => [...current.slice(-4), { id, ...payload }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-[100] flex w-[min(22rem,calc(100vw-2.5rem))] flex-col gap-3"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto animate-fade-up rounded-xl border p-4 shadow-[var(--shadow-lift)]',
              TONES[item.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{item.title}</p>
                {item.body && <p className="mt-0.5 text-sm opacity-90">{item.body}</p>}
                {item.href && (
                  <a
                    href={item.href}
                    className="mt-1.5 inline-block text-xs font-bold underline underline-offset-4"
                  >
                    View order
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
