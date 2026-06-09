import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Validates the ingress API key from an incoming request.
 *
 * Accepts the key in:
 *   - `x-api-key` header
 *   - `Authorization: Bearer <key>` header
 *
 * Returns `true` only when a key is configured AND the presented key matches.
 * Treats an empty/undefined `INGEST_API_KEY` as "no key configured" → rejects.
 */
export function validateApiKey(request: Request): boolean {
  const configuredKey = process.env.INGEST_API_KEY;
  if (!configuredKey) return false;

  // headers.get() returns string | null per Web Fetch API spec;
  // null here means the header is absent (strict equality check, not a null value we own).
  const xApiKey = request.headers.get('x-api-key');
  if (xApiKey !== null) return xApiKey === configuredKey;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearerKey = authHeader.slice('Bearer '.length);
    return bearerKey === configuredKey;
  }

  return false;
}

interface Session {
  user: { id: string };
  supabase: Awaited<ReturnType<typeof createClient>>;
}

/**
 * Requires an authenticated user session for in-app Route Handlers.
 *
 * Returns `{ user, supabase }` on success, or `undefined` if no session exists.
 * Callers should respond with a 401 when `undefined` is returned.
 */
export async function requireSession(): Promise<Session | undefined> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return undefined;
  return { user, supabase };
}

/**
 * Resolves the Supabase client to use for a POST /api/items request:
 *
 * - Valid API key present → `createAdminClient()` (bypasses RLS, trusted ingress)
 * - No valid API key → require authenticated session via `createClient()` + `getUser()`
 *
 * Returns `{ supabase, isAdmin }` on success or a 401 Response on auth failure.
 */
export async function resolveIngestClient(
  request: Request,
): Promise<{ supabase: SupabaseClient<Database>; isAdmin: boolean } | Response> {
  if (validateApiKey(request)) {
    return { supabase: createAdminClient(), isAdmin: true };
  }

  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { supabase: session.supabase, isAdmin: false };
}
