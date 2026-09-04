'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Supabase anonymous authentication.
 *
 * Every guest gets a real `auth.uid()` without ever seeing a login screen:
 * no registration, no password, no code. The session is what lets them read
 * their own order back afterwards under RLS — it is *not* the duplicate rule,
 * which is keyed on event + phone / event + email in the database.
 */

let inflight: Promise<string | null> | null = null;

/** Returns the current auth user id, signing in anonymously if there is none. */
export async function ensureAnonymousSession(): Promise<string | null> {
  inflight ??= start();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function start(): Promise<string | null> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Silence here is what makes this failure so hard to place: the guest is
    // told their session could not start and nothing says why.
    console.error(
      `[anonymous-session] sign-in failed: ${error.code ?? error.status ?? 'unknown'} — ${error.message}`,
    );
    return null;
  }
  return data.user?.id ?? null;
}
