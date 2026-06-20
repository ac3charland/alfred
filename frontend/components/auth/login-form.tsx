'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Input } from '@/components/atoms/input';
import { Label } from '@/components/atoms/label';
import { createClient } from '@/lib/supabase/client';

/**
 * Email + password login form. Uses the browser Supabase client so the session
 * cookie is set automatically in the browser.
 *
 * REQUIREMENT: The application owner must create their Supabase auth user via
 * the Supabase Dashboard (Authentication → Users → Add user). No self-service
 * sign-up is provided — alfred is a single-user system.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit() {
    setError(undefined);
    setIsPending(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // Refresh the RSC tree so the server layout re-runs requireUser(),
      // then push home.
      router.refresh();
      router.push('/');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      onSubmit={(event_) => {
        event_.preventDefault();
        void handleSubmit();
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(event_) => {
            setEmail(event_.target.value);
          }}
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(event_) => {
            setPassword(event_.target.value);
          }}
          disabled={isPending}
        />
      </div>

      {error === undefined ? undefined : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
