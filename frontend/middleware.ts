import { type NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

// Static assets that skip the auth/session middleware.
const STATIC_ASSET = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

function isPublicPath(pathname: string): boolean {
  return (
    // API routes self-authenticate (session OR the INGEST_API_KEY ingress) and must
    // return JSON 401 — never an HTML redirect. Gating them here would 302 the Siri /
    // external capture path (valid x-api-key, no session) to /login before the handler runs.
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.svg' ||
    // Next.js metadata routes serve icons without a file extension (e.g. /apple-icon?hash).
    pathname === '/apple-icon' ||
    // iOS fetches the standalone launch image at app start, possibly without a live
    // session; it carries no user data, so serve the navy splash brand-image publicly.
    pathname === '/splash' ||
    STATIC_ASSET.test(pathname)
  );
}

/**
 * Root middleware — refreshes the Supabase session cookie and redirects
 * unauthenticated visitors to /login (delegated to updateSession).
 *
 * NOTE (Next.js 16): the `middleware` file convention is deprecated in favor of
 * `proxy`, and `export const config = { matcher }` is no longer accepted (it trips
 * "Invalid segment configuration export"). Until we migrate to `proxy.ts`, the
 * static-asset exclusion that `config.matcher` used to do is handled inline via
 * isPublicPath() below.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  return updateSession(request);
}
