import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Defense-in-depth auth gate for Server Components, Server Actions, and
 * Route Handlers.
 *
 * Middleware redirects (lib/supabase/middleware.ts) are a first-pass convenience
 * only — they can be bypassed via the x-middleware-subrequest header
 * (CVE-2025-29927, CVSS 9.1, March 2025). This function is the real gate:
 * every protected server context MUST call it before touching user data.
 *
 * Usage:
 *   const user = await requireUser();
 *   // user is guaranteed non-null below this line
 *
 * REQUIREMENT: The application owner must create their Supabase auth user via
 * the Supabase Dashboard (Authentication → Users → Add user). No self-service
 * sign-up flow is provided — alfred is a single-user system.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return user;
}
