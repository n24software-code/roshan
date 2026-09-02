'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { supabasePublicKey, supabaseUrl } from './env';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser Supabase client. Carries only the publishable key. */
export function createClient() {
  client ??= createBrowserClient<Database>(supabaseUrl(), supabasePublicKey());
  return client;
}
