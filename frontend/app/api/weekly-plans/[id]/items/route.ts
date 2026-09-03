import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveIngestClient } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createWeeklyPlanItemsSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  getLatestWeeklyPlanWithItems,
  getWeeklyPlanById,
  getWeeklyPlanCohort,
} from '@/lib/data/weekly-plans';
import type { Database } from '@/lib/database.types';
import type { Item } from '@/lib/types';
import { toWeeklyPlanItemsPayload } from '@/lib/weekly-plan-items/payload';

// ---------------------------------------------------------------------------
// /api/weekly-plans/[id]/items — the weekly-review loop's two missing halves.
//
// The Friday review already archives a week-plan document; POST turns the work that document
// describes into real alfred items, and GET reads the same cohort back a week later to answer
// "of the things we agreed to do, which are done, when, and if not, what are they doing?".
//
// The plan is in the PATH rather than the body, so the association can't be forgotten or
// contradicted — and one route file owns both verbs, since they are two views of one cohort.
//
// Auth is `resolveIngestClient` on both — NOT `withSessionOrApiKey`, which yields no Supabase
// client: a keyed caller carries no cookie, so a route reaching for `createClient()` under it
// would read anonymously and answer a cheerful 200 with an empty list. A coach told "you
// created nothing last week" by an auth bug is worse than an error (the `/api/habits` trap).
// ---------------------------------------------------------------------------

/** The GET-only path segment meaning "whichever plan the last review actually built on". */
const LATEST = 'latest';

/** No cohort at all is a real answer, not an absence — the shape stays identical. */
const EMPTY_PAYLOAD = toWeeklyPlanItemsPayload({ plan: null, items: [], folders: [], code: [] });

/** Read the cohort hanging off `plan` and render the published payload. */
async function respondWithCohort(
  supabase: SupabaseClient<Database>,
  plan: { id: string; uploaded_at: string },
): Promise<Response> {
  const cohort = await getWeeklyPlanCohort(supabase, plan.id);
  if (cohort.error) {
    const { status, message } = mapSupabaseError(cohort.error);
    return jsonError(status, message);
  }
  return jsonOk(
    toWeeklyPlanItemsPayload({
      plan,
      items: cohort.items,
      folders: cohort.folders,
      code: cohort.code,
    }),
  );
}

// ---------------------------------------------------------------------------
// POST — create a week's items against the plan they came from.
//
// One call carries the whole week, roots with their children, written by a single plpgsql RPC so
// it is one transaction: a failure leaves nothing behind rather than a half-created week of
// childless roots nobody can tell apart from a plan that really had no subtasks.
//
// Everything lands in the Inbox — no folder, undispatched — because dispatch is a human act and
// an agent filing twenty rows straight into folders would be the first thing in the system to
// bypass triage. The classifier sweeps them like any other capture, filling only what the caller
// left blank.
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a 401 Response directly on auth failure.
  if (clientResult instanceof Response) return clientResult;
  const { supabase } = clientResult;

  const { id: rawId } = await context.params;
  // `latest` is a read-time convenience: a write states the plan it belongs to, so the segment
  // resolves to no plan here rather than to the newest one.
  if (rawId === LATEST) return jsonError(404, 'Weekly plan not found');
  const planId = parseUUID(rawId);
  if (planId instanceof Response) return planId;

  const input = await parseRequestBody(request, createWeeklyPlanItemsSchema);
  if (input instanceof Response) return input;

  // The plan is read before anything is written: the response echoes its `uploaded_at` anyway,
  // and a batch against a plan that doesn't exist must write nothing at all.
  const { plan, error: planError } = await getWeeklyPlanById(supabase, planId);
  if (planError) {
    const { status, message } = mapSupabaseError(planError);
    return jsonError(status, message);
  }
  if (plan === null) return jsonError(404, 'Weekly plan not found');

  const { data, error } = await supabase.rpc('create_weekly_plan_items', {
    p_plan: planId,
    p_items: input.items,
  });
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  const created: Item[] = data;
  // The same node shape the read publishes, so a caller that can read the cohort can read this
  // response with the same code. Fresh rows carry no folder and no factory sidecar by
  // construction, so there is nothing to resolve them against.
  const { items } = toWeeklyPlanItemsPayload({ plan, items: created, folders: [], code: [] });

  return jsonOk({ plan, created: created.length, items }, 201);
}

// ---------------------------------------------------------------------------
// GET — read the cohort's status.
//
// `latest` is the coach's whole read: one URL, no arguments, no date arithmetic, correct whether
// the review is held on Friday, slipped to Sunday, or skipped a week.
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  if (clientResult instanceof Response) return clientResult;
  const { supabase } = clientResult;

  const { id: rawId } = await context.params;

  if (rawId === LATEST) {
    const { plan, error } = await getLatestWeeklyPlanWithItems(supabase);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    // Never a 404 here: "no cohort has ever been created" is an answer about the archive, and a
    // coach reading 404 would have to treat it as an outage.
    if (plan === null) return jsonOk(EMPTY_PAYLOAD);
    return respondWithCohort(supabase, plan);
  }

  const planId = parseUUID(rawId);
  if (planId instanceof Response) return planId;

  const { plan, error } = await getWeeklyPlanById(supabase, planId);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }
  // An id naming no plan is a caller error; a plan with no items is not — it is not a mistake to
  // have planned nothing, so that case falls through to a 200 with an empty list.
  if (plan === null) return jsonError(404, 'Weekly plan not found');

  return respondWithCohort(supabase, plan);
}
