'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signInAdmin, type LoginState } from '@/lib/auth/actions';
import { Alert } from '@/components/ui/Alert';
import { inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Signing in...' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ forbidden }: { forbidden?: boolean }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signInAdmin, {});

  return (
    <form action={formAction} className="space-y-5">
      {forbidden && !state.error && (
        <Alert tone="error">This account does not have admin access.</Alert>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-semibold text-ink-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className={inputClass(Boolean(state.error))}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-semibold text-ink-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass(Boolean(state.error))}
        />
      </div>

      <SubmitButton />
    </form>
  );
}
