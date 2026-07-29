import type { PostgrestError } from '@supabase/supabase-js';
import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Folder } from '@/lib/types';

/**
 * Server-only read layer for folders.
 *
 * Server Components read folder data through these functions instead of reaching
 * into `supabase.from('folders')` inline, so the queries live in one place. Client
 * components never import this — they read from the FoldersProvider store and mutate
 * via lib/api-client.
 */

/**
 * All folders in the sidebar's display order: the manual rank (ALF-153), which the migration
 * seeded from `created_at` so an untouched list still reads oldest-first.
 */
export async function getFolders(): Promise<Folder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('folders')
    .select('*')
    .order('sort_order', { ascending: true });
  return data ?? [];
}

/**
 * The GET /api/folders read: all folders in display order, returning the raw Supabase
 * `{ data, error }` so the route can map the error to a status. Parallel to `getFolders`
 * (the layout's graceful `[]`-fallback seed reader) — the API path needs the error, the
 * seed path swallows it, so they stay separate readers.
 */
export async function getFolderList(): Promise<{
  data: Folder[] | null;
  error: PostgrestError | null;
}> {
  const supabase = await createClient();
  return supabase.from('folders').select('*').order('sort_order', { ascending: true });
}
