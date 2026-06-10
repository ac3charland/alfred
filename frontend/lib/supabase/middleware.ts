import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import type { Database } from '@/lib/database.types';

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated visitors to /login.
 *
 * NOTE: Middleware redirects are a first line of defence only. They can be
 * bypassed via the x-middleware-subrequest header (CVE-2025-29927, CVSS 9.1).
 * Server Components and Route Handlers MUST call requireUser() as the real gate.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Start with a response that passes through the request.
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        // Read all cookies from the incoming request.
        getAll() {
          return request.cookies.getAll();
        },
        // Write refreshed cookies to both the outgoing request (so Server
        // Components see them) and the response (so the browser receives them).
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() validates the JWT against the Auth server — required in middleware
  // to ensure the access token is genuinely valid, not just locally parseable.
  // Never use getSession() here; it skips server-side validation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect to /login if there is no authenticated user and the request is
  // not already headed to /login.
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
