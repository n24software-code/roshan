import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { supabasePublicKey, supabaseUrl } from './env';

/**
 * Builds a Supabase client bound to the proxy request/response pair so the auth
 * session is refreshed and the rotated cookies reach the browser.
 */
export function createProxySupabase(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl(), supabasePublicKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, response };
}
