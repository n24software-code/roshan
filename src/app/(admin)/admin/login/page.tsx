import { LoginForm } from '@/components/admin/LoginForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            aria-hidden="true"
            className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-700 text-lg font-bold text-white"
          >
            ⌂
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
            Admin sign in
          </h1>
          <p className="mt-1 text-sm text-ink-500">Event restaurant ordering dashboard</p>
        </div>

        <div className="card-surface p-6">
          <LoginForm forbidden={error === 'forbidden'} />
        </div>
      </div>
    </div>
  );
}
