'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { signOutAdmin } from '@/lib/auth/actions';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/admin/orders', label: 'Orders', icon: '☰' },
  { href: '/admin/restaurants', label: 'Restaurants', icon: '⌂' },
  { href: '/admin/menu', label: 'Menu', icon: '✧' },
  { href: '/admin/customers', label: 'Customers', icon: '☺' },
  { href: '/admin/events', label: 'Events', icon: '◈' },
  { href: '/admin/notifications', label: 'Notifications', icon: '⌁' },
  { href: '/admin/reports', label: 'Reports', icon: '◑' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙' },
] as const;

export function Sidebar({ email, unread }: { email: string; unread: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Admin sections">
      {NAV.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <Link
            key={entry.href}
            href={entry.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
              active
                ? 'bg-brand-700 text-white'
                : 'text-brand-100 hover:bg-white/10 hover:text-white',
            )}
          >
            <span aria-hidden="true" className="w-4 text-center opacity-80">
              {entry.icon}
            </span>
            <span className="flex-1">{entry.label}</span>
            {entry.href === '/admin/notifications' && unread > 0 && (
              <span className="numeric rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-ink-900">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* mobile trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="fixed top-4 left-4 z-50 grid h-10 w-10 place-items-center rounded-lg bg-brand-800 text-white lg:hidden"
      >
        ☰
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-brand-900 px-4 py-6 text-white transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-sm font-bold"
            >
              ⌂
            </span>
            <span className="text-sm font-extrabold tracking-tight">Event Dining</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="text-xl leading-none text-brand-200 lg:hidden"
          >
            ×
          </button>
        </div>

        <div className="mt-8 flex flex-1 flex-col">{nav}</div>

        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="truncate px-3 text-xs text-brand-200" title={email}>
            {email}
          </p>
          <form action={signOutAdmin}>
            <button
              type="submit"
              className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-100 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden="true" className="w-4 text-center opacity-80">
                ⏻
              </span>
              Logout
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
