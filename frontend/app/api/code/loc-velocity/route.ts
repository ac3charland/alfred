import { resolveIngestClient } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { listProjectRepos } from '@/lib/data/code';
import { getGithubRepoConfig } from '@/lib/github/config';
import { fetchLocVelocity } from '@/lib/github/loc';

// ---------------------------------------------------------------------------
// GET /api/code/loc-velocity — lines added + removed per calendar week across the Code
// module's projects (one repo each, oldest project first), for the Dashboard's velocity chart.
// The same repo set the PR ratio measures, so the two cards on one page cover the same ground.
//
// No query params: GitHub buckets these statistics on Sunday-UTC weeks and does so itself, so
// there is no timezone for the caller to name (unlike the PR ratio's rolling window, whose ends
// are instants the caller can render in their own zone).
//
// Session OR the ingest API key, resolved through `resolveIngestClient`: the repo set is read
// from `projects`, and a keyed caller carries no cookie, so only the admin client can read it
// for them.
//
// Four outcomes, each load-bearing for the card: 501 "this deployment doesn't measure repos"
// (no token, or no projects), which renders nothing at all; 202 "GitHub is still computing these
// statistics", which the card polls quietly behind until it clears; 502 "configured, but GitHub
// wouldn't answer", which shows a muted note. Collapsing either of the last two into silence
// would read as "you wrote no code for three months". A failed projects read maps to its own
// status, never 501, for the same reason.
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a 401 Response directly on auth failure.
  if (clientResult instanceof Response) return clientResult;

  const { data: projects, error } = await listProjectRepos(clientResult.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  const config = getGithubRepoConfig(projects ?? []);
  if (!config) return jsonError(501, 'Lines-changed velocity is not configured');

  const outcome = await fetchLocVelocity(config, new Date());
  if (outcome.status === 'computing') {
    // 202 is not a failure, but it is the same "no payload, here's why" envelope, and
    // `jsonError` is the one helper that writes it.
    return jsonError(202, 'GitHub is still computing these statistics');
  }
  if (outcome.status === 'failed') return jsonError(502, 'GitHub request failed');

  return jsonOk(outcome.velocity);
}
