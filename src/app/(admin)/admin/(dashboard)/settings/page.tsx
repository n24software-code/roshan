import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { getSettings } from '@/lib/data/admin';
import { getActiveEvent } from '@/lib/data/customer';
import { PageHeader } from '@/components/admin/PageHeader';
import { SettingsForm } from '@/components/admin/SettingsForm';
import { hasServiceRoleKey } from '@/lib/supabase/env';
import { anonymousSignInsEnabled } from '@/lib/supabase/health';
import { Alert } from '@/components/ui/Alert';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { supabase, user } = await requireAdmin();
  const [settings, event, anonymousEnabled] = await Promise.all([
    getSettings(supabase),
    getActiveEvent(),
    anonymousSignInsEnabled(),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Dashboard preferences and environment status." />

      <div className="space-y-6">
        {!hasServiceRoleKey() && (
          <Alert tone="error" title="SUPABASE_SERVICE_ROLE_KEY is not set">
            Guests cannot place orders until this server-side key is configured. Add it to your
            environment and restart the app.
          </Alert>
        )}

        {anonymousEnabled === false && (
          <Alert tone="error" title="Anonymous sign-ins are disabled in Supabase">
            Guests cannot place orders: every submission fails with “We could not start your
            session.” Enable it in the Supabase dashboard under Authentication → Sign In / Providers
            → Anonymous sign-ins.
          </Alert>
        )}

        <SettingsForm soundEnabled={settings.sound_notifications !== false} />

        <section className="card-surface max-w-2xl p-6">
          <h2 className="text-lg font-extrabold text-ink-900">Event branding</h2>
          <p className="mt-1 text-sm text-ink-500">
            The storefront name, description, logo and hero image come from the running event.
          </p>
          <dl className="mt-4 divide-y divide-sand-200 border-t border-sand-200">
            <Row label="Active event" value={event?.name_en ?? 'None'} />
            <Row label="Storefront slug" value={event?.slug ?? '—'} />
            <Row label="Order prefix" value={event?.order_prefix ?? '—'} />
          </dl>
          <Link
            href="/admin/events"
            className="mt-4 inline-block text-sm font-bold text-brand-700 underline underline-offset-4"
          >
            Manage events
          </Link>
        </section>

        <section className="card-surface max-w-2xl p-6">
          <h2 className="text-lg font-extrabold text-ink-900">Account</h2>
          <dl className="mt-4 divide-y divide-sand-200 border-t border-sand-200">
            <Row label="Signed in as" value={user.email ?? '—'} />
            <Row label="Role" value="admin" />
          </dl>
        </section>

        <section className="card-surface max-w-2xl p-6">
          <h2 className="text-lg font-extrabold text-ink-900">Guest sessions</h2>
          <p className="mt-2 text-sm text-ink-500">
            Guests are never asked to register, log in or enter a code. Each browser is given a
            Supabase anonymous session, which must stay enabled in the Supabase dashboard under
            Authentication → Sign In / Providers → Anonymous sign-ins
            {anonymousEnabled === true && ' (currently enabled)'}
            {anonymousEnabled === false && ' (currently DISABLED — ordering is blocked)'}. Duplicate
            orders are blocked by the database: one order per event per mobile number, and per email
            address.
          </p>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm font-semibold text-ink-500">{label}</dt>
      <dd className="text-sm font-bold text-ink-900">{value}</dd>
    </div>
  );
}
