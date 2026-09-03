import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type { Folder, Item, WeeklyPlan, WeeklyPlanSummary } from '@/lib/types';
import type { WeeklyPlanCodeSidecar } from '@/lib/weekly-plan-items/payload';

/**
 * Server-only read layer for the weekly plan archive.
 *
 * Unlike the other entities, the shell does NOT seed every row: each plan is tens of KB of
 * HTML and the archive grows by one a week, so seeding all of them would inflate every page
 * load in the app. The layout seeds the *index* (no documents) plus the *latest* plan's
 * document; an older plan's HTML is pulled on demand through `/api/weekly-plans/[id]` and
 * cached in the store.
 */

/** The picker index, newest first. Deliberately excludes `html`. */
export async function getWeeklyPlanIndex(): Promise<WeeklyPlanSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('weekly_plans')
    .select('id, uploaded_at')
    .order('uploaded_at', { ascending: false });
  return data ?? [];
}

/** The most recent plan with its document, or undefined when nothing has been uploaded. */
export async function getLatestWeeklyPlan(): Promise<WeeklyPlan | undefined> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  // Take the head of the list rather than `.maybeSingle()`: that helper enforces cardinality
  // client-side over whatever comes back, so it errors out on an archive of more than one row
  // if the `limit` ever fails to narrow the result.
  return data?.[0];
}

// ---------------------------------------------------------------------------
// The cohort reads — the items a review created against a plan, and what became of them.
//
// Unlike the seeders above these take the client rather than creating one: the caller is the
// weekly-review coach holding the ingest key, which carries no cookie, so a reader reaching for
// `createClient()` would read anonymously and answer "nothing was planned" (the `lib/data/habits`
// trap). They surface the Supabase error for the same reason — an endpoint that says "you
// created nothing last week" because the database was unreachable is worse than an error.
// ---------------------------------------------------------------------------

/**
 * How far back `getLatestWeeklyPlanWithItems` will look for a cohort. Half a year of weekly
 * plans: the review reads back one week at a time, so the first candidate is normally the answer
 * and the walk costs one extra query. The bound is what keeps the pathological case — an archive
 * where nothing has ever been created — from being one round trip per plan ever uploaded.
 */
export const LATEST_PLAN_CANDIDATES = 26;

/** The plan a cohort hangs off. `html` is deliberately absent: the read wants the id and date. */
export async function getWeeklyPlanById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ plan: WeeklyPlanSummary | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('id, uploaded_at')
    .eq('id', id)
    .limit(1);
  if (error) return { plan: null, error };
  return { plan: data[0] ?? null, error: null };
}

/**
 * The newest plan that has at least one item attached — the coach's whole read, with no
 * arguments and no date arithmetic, correct whether the review is held on Friday, slipped to
 * Sunday, or skipped a week.
 *
 * "With items" rather than merely "newest": re-posting a revised plan appends another archive
 * row, and if `latest` meant the newest row, one revision nothing was created against would make
 * the coach report an empty week.
 */
export async function getLatestWeeklyPlanWithItems(
  supabase: SupabaseClient<Database>,
): Promise<{ plan: WeeklyPlanSummary | null; error: PostgrestError | null }> {
  const { data: plans, error } = await supabase
    .from('weekly_plans')
    .select('id, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(LATEST_PLAN_CANDIDATES);
  if (error) return { plan: null, error };

  // Newest-first, one probe each, stopping at the first hit — normally the very first, since the
  // review posts its plan and then creates that week's items against it.
  for (const plan of plans) {
    const { data, error: itemsError } = await supabase
      .from('items')
      .select('id')
      .eq('weekly_plan_id', plan.id)
      .limit(1);
    if (itemsError) return { plan: null, error: itemsError };
    if (data.length > 0) return { plan, error: null };
  }
  return { plan: null, error: null };
}

/**
 * One cohort's rows plus everything the payload resolves against them: the folders they were
 * filed into and the factory sidecars of whichever ones entered the Software Factory.
 *
 * The rows come from the `items` TABLE, not the `task_items` view: a planned code item that has
 * been gated into the factory leaves that view, and it is precisely the row a review asks about.
 *
 * No paging. A cohort is tens of rows — the create endpoint caps a batch at 100 nodes — so the
 * single default range is ample unless one plan is appended to ten times.
 */
export async function getWeeklyPlanCohort(
  supabase: SupabaseClient<Database>,
  planId: string,
): Promise<{
  items: Item[];
  folders: Pick<Folder, 'id' | 'name'>[];
  code: WeeklyPlanCodeSidecar[];
  error: PostgrestError | null;
}> {
  const empty = { items: [], folders: [], code: [] };

  const { data: items, error } = await supabase
    .from('items')
    .select('*')
    .eq('weekly_plan_id', planId);
  if (error) return { ...empty, error };
  if (items.length === 0) return { ...empty, error: null };

  // An empty `in.()` is a query with no answer worth asking for, so each follow-up is skipped
  // when nothing in the cohort references it.
  const folderIds = [...new Set(items.map((item) => item.folder_id).filter((id) => id !== null))];
  const codeIds = items.filter((item) => item.item_type === 'code').map((item) => item.id);

  let folders: Pick<Folder, 'id' | 'name'>[] = [];
  if (folderIds.length > 0) {
    const { data, error: foldersError } = await supabase
      .from('folders')
      .select('id, name')
      .in('id', folderIds);
    if (foldersError) return { ...empty, error: foldersError };
    folders = data;
  }

  let code: WeeklyPlanCodeSidecar[] = [];
  if (codeIds.length > 0) {
    const { data, error: codeError } = await supabase
      .from('code_items')
      .select('item_id, ref, lane, factory_state, done_at')
      .in('item_id', codeIds);
    if (codeError) return { ...empty, error: codeError };
    code = data;
  }

  return { items, folders, code, error: null };
}
