import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/lib/database.types';

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses the publishable (anon) key + the user's session cookies, so RLS applies.
 * Cookie writes from a Server Component throw (read-only context) — that's caught
 * and ignored; the middleware client is responsible for refreshing the session.
 */
export async function createClient() {
  const cookieStore = await cookies();

  // createServerClient throws synchronously on an empty URL/key. When Supabase
  // isn't configured, use a non-routable placeholder so getUser() fails with a
  // fast ECONNREFUSED instead of throwing, returning { user: null } cleanly.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:1';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies. Safe to
          // ignore when middleware is refreshing the session on every request.
        }
      },
    },
  });
}
