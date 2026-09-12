import { withSessionOrApiKey } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { getGithubRepoConfig } from '@/lib/github/config';
import { fetchLocVelocity } from '@/lib/github/loc';

// ---------------------------------------------------------------------------
// GET /api/code/loc-velocity — lines added + removed per calendar week across the configured
// repos, by the configured authors, for the Dashboard's velocity chart.
//
// No query params: GitHub buckets these statistics on Sunday-UTC weeks and does so itself, so
// there is no timezone for the caller to name (unlike the PR ratio's rolling window, whose ends
// are instants the caller can render in their own zone).
//
// Dual auth (browser session OR ingest API key), so the same numbers the card shows are
// reachable from a script without going through the UI.
//
// Four outcomes, each load-bearing for the card: 501 "this deployment doesn't measure repos",
// which renders nothing at all; 202 "GitHub is still computing these statistics", which invites
// a refresh; 502 "configured, but GitHub wouldn't answer", which shows a muted note. Collapsing
// either of the last two into silence would read as "you wrote no code for three months".
// ---------------------------------------------------------------------------

export const GET = withSessionOrApiKey(async () => {
  const config = getGithubRepoConfig();
  if (!config) return jsonError(501, 'Lines-changed velocity is not configured');

  const outcome = await fetchLocVelocity(config, new Date());
  if (outcome.status === 'computing') {
    // 202 is not a failure, but it is the same "no payload, here's why" envelope, and
    // `jsonError` is the one helper that writes it.
    return jsonError(202, 'GitHub is still computing these statistics');
  }
  if (outcome.status === 'failed') return jsonError(502, 'GitHub request failed');

  return jsonOk(outcome.velocity);
});
