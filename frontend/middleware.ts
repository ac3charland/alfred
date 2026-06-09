import { type NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

// Static assets that skip the auth/session middleware.
const STATIC_ASSET = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
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
