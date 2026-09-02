/**
 * Creates (or promotes) an admin account for the dashboard.
 *
 *   node scripts/create-admin.mjs admin@example.com 'a-strong-password'
 *
 * There is no admin sign-up page by design: the `admin` role can only be
 * granted server-side with the service-role key.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load .env.local without adding a dependency.
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // file is optional
  }
}

const [email, password] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.mjs <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('The password must be at least 8 characters.');
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId;

const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (created.error) {
  if (!/already/i.test(created.error.message)) {
    console.error(`Could not create the user: ${created.error.message}`);
    process.exit(1);
  }

  // The account exists — find it and reset the password instead.
  const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error(`Could not look up the existing user: ${error.message}`);
    process.exit(1);
  }
  const existing = list.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!existing) {
    console.error('The account exists but could not be found in the first 1000 users.');
    process.exit(1);
  }
  userId = existing.id;
  await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  console.log(`Updated the password for the existing account ${email}.`);
} else {
  userId = created.data.user.id;
  console.log(`Created account ${email}.`);
}

const { error: roleError } = await admin
  .from('user_roles')
  .upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id,role' });

if (roleError) {
  // The most common cause by far: the migrations have not been applied yet.
  if (roleError.code === 'PGRST205' || /user_roles/.test(roleError.message)) {
    console.error(
      `\nThe account exists, but the admin role could not be granted because the\n` +
        `database schema has not been applied yet.\n\n` +
        `  1. Open the Supabase SQL Editor for your project\n` +
        `  2. Paste and run supabase/setup.sql\n` +
        `  3. Re-run this command — it will find this account and grant the role\n`,
    );
    process.exit(1);
  }
  console.error(`Could not grant the admin role: ${roleError.message}`);
  process.exit(1);
}

console.log(`Granted the admin role. Sign in at /admin/login.`);
