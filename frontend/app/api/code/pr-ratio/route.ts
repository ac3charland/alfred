import { resolveIngestClient } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { prRatioQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { listProjectRepos } from '@/lib/data/code';
import { getPrRatioConfig } from '@/lib/github/config';
import { fetchPrRatio } from '@/lib/github/pr-ratio';
import { rollingWeekWindow } from '@/lib/github/week';

/**
 * The window's timestamps are rendered in UTC for a caller that names no timezone (a script,
 * a Shortcut). It shifts no boundary — the seven days are the same instants either way.
 */
const DEFAULT_TIMEZONE = 'UTC';

// ---------------------------------------------------------------------------
// GET /api/code/pr-ratio — the merged-PR split across the Code module's projects (one repo
// each, oldest project first, labelled by project name) for the seven days ending NOW, so a
// review held on a Friday (or a slipped Sunday) sees a full week of work instead of only the
// days since Monday.
//
// Session OR the ingest API key, resolved through `resolveIngestClient`: the repo set is read
// from `projects`, and a keyed caller carries no cookie, so only the admin client can read it
// for them. Same number the Dashboard card shows, reachable from a script.
//
// The 501/502 split is load-bearing for the caller: 501 means "this deployment doesn't do PR
// ratios" (no token, or fewer than two projects), which the card treats as "render nothing";
// 502 means "configured, but GitHub is unhappy right now", which it shows as a muted note —
// silence there would read as "zero PRs merged this week". A failed projects read is neither:
// it maps to its own status, never 501, so a database hiccup can't make the card vanish.
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a 401 Response directly on auth failure.
  if (clientResult instanceof Response) return clientResult;

  const query = parseQueryParams(request, prRatioQuerySchema);
  if (query instanceof Response) return query;

  const { data: projects, error } = await listProjectRepos(clientResult.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  const config = getPrRatioConfig(projects ?? []);
  if (!config) return jsonError(501, 'PR ratio is not configured');

  const week = rollingWeekWindow(new Date(), query.tz ?? DEFAULT_TIMEZONE);
  const ratio = await fetchPrRatio(config, week);
  if (!ratio) return jsonError(502, 'GitHub request failed');

  return jsonOk(ratio);
}
