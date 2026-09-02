import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { serviceRoleKey, supabaseUrl } from './env';

/**
 * Service-role client. Bypasses RLS, so it must only ever be constructed inside
 * server actions and route handlers that have already authorized the caller.
 */
export function createAdminSupabase() {
  return createClient<Database>(supabaseUrl(), serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
