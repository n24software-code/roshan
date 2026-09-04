import 'server-only';

import { supabasePublicKey, supabaseUrl } from './env';

/**
 * Reads the project's public auth settings.
 *
 * The storefront cannot place an order unless anonymous sign-ins are enabled,
 * and that is a Supabase dashboard setting rather than anything in this repo.
 * Surfacing it in the admin Settings page turns "We could not start your
 * session" from a mystery into a one-line instruction.
 */
export async function anonymousSignInsEnabled(): Promise<boolean | null> {
  try {
    const response = await fetch(`${supabaseUrl()}/auth/v1/settings`, {
      headers: { apikey: supabasePublicKey() },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const settings = (await response.json()) as { external?: { anonymous_users?: boolean } };
    return settings.external?.anonymous_users ?? null;
  } catch {
    // Network problem or missing configuration: report "unknown", never throw
    // — this check must not be able to break the dashboard.
    return null;
  }
}
