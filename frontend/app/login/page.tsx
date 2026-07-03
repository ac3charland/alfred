import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { createClient } from '@/lib/supabase/server';

/**
 * Login page (Server Component).
 *
 * If the visitor is already authenticated this page redirects to / immediately,
 * so a signed-in user never sees the form. Otherwise it renders the LoginForm.
 *
 * REQUIREMENT: The application owner must create their auth user in the Supabase
 * Dashboard (Authentication → Users → Add user). No self-service sign-up exists.
 */
export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/');
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-8 shadow-lg glow-teal">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl text-foreground tracking-tight">alfred</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
