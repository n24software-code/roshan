/**
 * Opt-in gate for tests that write to a real Supabase project.
 *
 * These suites create and delete rows, flip restaurant statuses and upload
 * storage objects. Pointed at a project that serves real traffic they leave
 * debris behind — a disabled-restaurant notification per run, for instance,
 * because the trigger that raises it is working exactly as intended.
 *
 * Credentials alone are therefore not enough to opt in: `.env.local` holds the
 * live project, so anyone running `npm test` would hit it by accident. The
 * operator must also name a disposable project explicitly:
 *
 *   ALLOW_DB_INTEGRATION_TESTS=true npm test
 *
 * Without it the suites skip, and `npm test` stays safe to run anywhere.
 */

export interface IntegrationTarget {
  enabled: boolean;
  url: string | undefined;
  serviceKey: string | undefined;
  publicKey: string | undefined;
  reason: string;
}

export function integrationTarget(): IntegrationTarget {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const optedIn = process.env.ALLOW_DB_INTEGRATION_TESTS === 'true';

  let reason = '';
  if (!url || !serviceKey) reason = 'no Supabase credentials in the environment';
  else if (!optedIn) reason = 'ALLOW_DB_INTEGRATION_TESTS is not "true"';

  return { enabled: Boolean(url && serviceKey && optedIn), url, serviceKey, publicKey, reason };
}
