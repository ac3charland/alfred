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

/** All folders, oldest first (the sidebar's display order). */
export async function getFolders(): Promise<Folder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('folders')
    .select('*')
    .order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * A single folder by id, or null if it does not exist. The caller decides what an
 * absent folder means (e.g. the folder page calls notFound()) — control flow stays
 * out of the data layer.
 */
export async function getFolder(id: string): Promise<Folder | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('folders').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}
