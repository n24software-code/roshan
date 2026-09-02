'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { adminInput } from './AdminForm';

/** Debounced search box that keeps its term in the URL. */
export function SearchInput({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set('q', value);
      else params.delete('q');
      params.delete('page');

      const next = `${pathname}?${params.toString()}`;
      if (next !== `${pathname}?${searchParams.toString()}`) {
        startTransition(() => router.replace(next));
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, pathname, router, searchParams]);

  return (
    <div className="relative w-full sm:w-72">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400"
      >
        ⌕
      </span>
      <label htmlFor="admin-search" className="sr-only">
        {placeholder}
      </label>
      <input
        id="admin-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className={`${adminInput} pl-9`}
      />
    </div>
  );
}

/** Filter pills that write their value into a URL parameter. */
export function FilterTabs({
  param,
  options,
}: {
  param: string;
  options: { value: string; label: string; count?: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(param) ?? options[0]?.value;

  function select(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === options[0]?.value) params.delete(param);
    else params.set(param, value);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="scrollbar-none flex gap-2 overflow-x-auto" role="group" aria-label="Filters">
      {options.map((option) => {
        const selected = active === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => select(option.value)}
            aria-pressed={selected}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors',
              selected
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-sand-300 bg-white text-ink-600 hover:bg-sand-100',
            )}
          >
            {option.label}
            {typeof option.count === 'number' && (
              <span className="numeric ml-1.5 opacity-70">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (pageCount <= 1) {
    return (
      <p className="numeric mt-4 text-sm text-ink-500">
        {total} result{total === 1 ? '' : 's'}
      </p>
    );
  }

  return (
    <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Pagination">
      <p className="numeric text-sm text-ink-500">
        Page {page} of {pageCount} · {total} results
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
          className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
