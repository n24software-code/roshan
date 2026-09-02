import 'server-only';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Authorization gate for every admin page and mutation.
 *
 * Route protection in middleware is a convenience; this is the real check, and
 * it runs on the server for each request. The `admin` role lives in
 * `user_roles`, never in a cookie or a client flag.
 */
export async function requireAdmin() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/admin/login');

  const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: user.id });
  if (!isAdmin) redirect('/admin/login?error=forbidden');

  return { supabase, user };
}

/** Non-redirecting variant for mutations, which return an error instead. */
export async function getAdminContext() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: user.id });
  if (!isAdmin) return null;

  return { supabase, user };
}

/** Appends an entry to the admin audit trail. Best effort — never blocks a write. */
export async function auditLog(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  meta: Record<string, unknown> = {},
) {
  await supabase
    .from('admin_audit_logs')
    .insert({ user_id: userId, action, entity, entity_id: entityId, meta })
    .then(
      () => undefined,
      () => undefined,
    );
}
