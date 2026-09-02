'use client';

import { useEffect, useRef } from 'react';

/**
 * Dialog built on <dialog> so focus trapping, Escape and the backdrop come from
 * the platform rather than from hand-rolled key handling.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`w-[calc(100vw-2rem)] rounded-2xl border border-sand-200 bg-white p-0 shadow-[var(--shadow-lift)] backdrop:bg-ink-900/50 ${
        wide ? 'max-w-3xl' : 'max-w-lg'
      }`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-sand-200 px-6 py-4">
            <h2 className="text-lg font-extrabold text-ink-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="text-2xl leading-none text-ink-400 hover:text-ink-700"
            >
              ×
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

          {footer && (
            <footer className="flex justify-end gap-3 border-t border-sand-200 bg-sand-50 px-6 py-4">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
