import { withSessionOrApiKey } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { prRatioQuerySchema } from '@/lib/api/schemas';
import { getPrRatioConfig } from '@/lib/github/config';
import { fetchPrRatio } from '@/lib/github/pr-ratio';
import { rollingWeekWindow } from '@/lib/github/week';

/**
 * The window's timestamps are rendered in UTC for a caller that names no timezone (a script,
 * a Shortcut). It shifts no boundary — the seven days are the same instants either way.
 */
const DEFAULT_TIMEZONE = 'UTC';

// ---------------------------------------------------------------------------
// GET /api/code/pr-ratio — the merged-PR split across the configured repos for the seven
// days ending NOW, so a review held on a Friday (or a slipped Sunday) sees a full week of
// work instead of only the days since Monday.
//
// Dual auth (browser session OR ingest API key), so the same number the Backlog card shows
// is reachable from a script without going through the UI.
//
// The 501/502 split is load-bearing for the caller: 501 means "this deployment doesn't do PR
// ratios", which the card treats as "render nothing"; 502 means "configured, but GitHub is
// unhappy right now", which it shows as a muted note — silence there would read as "zero PRs
// merged this week".
// ---------------------------------------------------------------------------

export const GET = withSessionOrApiKey(async (request) => {
  const query = parseQueryParams(request, prRatioQuerySchema);
  if (query instanceof Response) return query;

  const config = getPrRatioConfig();
  if (!config) return jsonError(501, 'PR ratio is not configured');

  const week = rollingWeekWindow(new Date(), query.tz ?? DEFAULT_TIMEZONE);
  const ratio = await fetchPrRatio(config, week);
  if (!ratio) return jsonError(502, 'GitHub request failed');

  return jsonOk(ratio);
});
