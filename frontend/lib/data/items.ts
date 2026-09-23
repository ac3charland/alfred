import type { PostgrestError } from '@supabase/supabase-js';
import 'server-only';

import type { ListItemsQuery } from '@/lib/api/schemas';
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

/**
 * Scoped read over the `task_items` view for the keyed GET /api/items endpoint.
 *
 * Reads the SAME view `getAllItems` does (see its doc comment for the exclusion this relies
 * on) rather than the raw `items` table: every caller of this endpoint is a browser session
 * (it sits behind `withSession` — see `lib/api/auth`), and nothing in the app needs to see an
 * item gated into the Software Factory back out through this list. In particular, the Tasks
 * store's navigation refetch (`refreshVerdicts`, ALF-246) reconciles its OWN held rows broadly
 * against a fresh fetch and inserts any row it doesn't already hold — a gated item was already
 * removed from that store on the way out, so handing it back here would resurrect it into the
 * Inbox. Reading `task_items` unconditionally makes that impossible rather than relying on
 * every caller to opt in.
 *
 * Returns the raw Supabase `{ data, error }` so the route can map the error to a status
 * (`mapSupabaseError`) — the read layer reports, it doesn't decide HTTP codes.
 *
 *   - `inbox: true`              → items still awaiting triage (`.is('dispatched_at', null)`),
 *                                  whatever folder they may already carry
 *   - else `folder` provided     → items in that folder (`.eq`)
 *   - `status` (default 'active')→ filter unless 'all'
 *   - always ordered newest-first
 */
export async function getItems(
  query: ListItemsQuery,
): Promise<{ data: Item[] | null; error: PostgrestError | null }> {
  const supabase = await createClient();
  let builder = supabase.from('task_items').select('*');

  if (query.inbox === true) {
    // Inbox: items no human has dispatched yet — must use .is(), not .eq()
    builder = builder.is('dispatched_at', null);
  } else if (query.folder !== undefined) {
    builder = builder.eq('folder_id', query.folder);
  }

  const resolvedStatus = query.status ?? 'active';
  if (resolvedStatus !== 'all') {
    builder = builder.eq('status', resolvedStatus);
  }

  // `task_items` is `select i.*` over `items`, so every row IS a full `items` row — but
  // Postgres views carry no NOT NULL metadata, so the generated view type makes every column
  // nullable. Override it back to `Item` (the real, non-null row shape the view always
  // yields), same as `getAllItems`.
  return builder.order('created_at', { ascending: false }).overrideTypes<Item[]>();
}
