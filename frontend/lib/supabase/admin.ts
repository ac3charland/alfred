import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { Database } from '@/lib/database.types';

/**
 * Server-only Supabase client using the secret (service_role) key. BYPASSES ALL
 * RLS — use only in trusted server contexts (e.g. the API-key-protected capture
 * ingress). The `server-only` import makes importing this from a Client Component
 * a build error, so the secret key can never reach the browser bundle.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
