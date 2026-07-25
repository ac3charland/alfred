import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { WeeklyPlan, WeeklyPlanSummary } from '@/lib/types';

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
