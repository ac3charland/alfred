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

/**
 * Every NON-factory item, newest first. Filtered per view in the client
 * (see lib/stores/tasks-store).
 *
 * Reads the `task_items` view rather than the raw `items` table: the view drops any
 * item that has a `code_items` sidecar, so a story sent to the Software Factory
 * leaves the Tasks/Inbox views. A code-*classified-but-not-yet-sent* item (item_type
 * 'code', no sidecar) still appears here — membership is decided by the sidecar, not the
 * type. The view returns the full `items` row shape, so the per-view client filters and
 * the subtree tree-building are unchanged.
 */
export async function getAllItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('task_items')
    .select('*')
    .order('created_at', { ascending: false })
    // `task_items` is `select i.*` over `items`, so every row IS a full `items` row — but
    // Postgres views carry no NOT NULL metadata, so the generated view type makes every
    // column nullable. Override it back to `Item` (the real, non-null row shape the view
    // always yields) so the tasks store keeps its `Item[]` contract.
    .overrideTypes<Item[]>();
  return data ?? [];
}
