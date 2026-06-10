import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Item } from '@/lib/types';

/**
 * Server-only read layer for items.
 *
 * The whole item set is fetched once (at the layout level, alongside folders) and seeded
 * into the tasks store; each view filters it client-side (inbox / folder / completed).
 * Volume is small for the foreseeable future, so a single fetch beats per-view round-trips
 * and per-navigation re-seeding. Revisit (scoped/paginated reads) only if the list grows
 * large enough to matter.
 */

/** Every item, newest first. Filtered per view in the client (see lib/stores/tasks-store). */
export async function getAllItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}
