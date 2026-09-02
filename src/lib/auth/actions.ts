'use server';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { adminLoginSchema } from '@/lib/validation/schemas';

export type LoginState = { error?: string };

/** Admin sign-in. Credentials are checked by Supabase Auth; the admin role is
 *  verified separately so a normal user account cannot reach the dashboard. */
export async function signInAdmin(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = adminLoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: 'Enter a valid email address and password.' };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { error: 'Incorrect email or password.' };
  }

  const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: data.user.id });
  if (!isAdmin) {
    await supabase.auth.signOut();
    return { error: 'This account does not have admin access.' };
  }

  redirect('/admin/dashboard');
}

export async function signOutAdmin() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect('/admin/login');
}
