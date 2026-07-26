import 'server-only';

import { stableSorted } from '@/lib/sort';
import type { PrRatioResponse } from '@/lib/types';

import type { PrRatioConfig, RatioRepo } from './config';
import type { WeekWindow } from './week';

/**
 * The weekly merged-PR split, counted live from the GitHub Search API.
 *
 * `server-only`: the fan-out carries the fine-grained PAT, so importing this from a Client
 * Component is a build error rather than a leaked token.
 *
 * Nothing is read from Supabase. The webhook Worker only sees PRs whose body carries an
 * `alfred` frontmatter block, and `code_items.implementation_pr_url` has no merge timestamp,
 * so the tables can answer neither "was it merged this week" nor "what about the PRs the
 * factory never saw" — and most of the PRs being measured are in that second bucket.
 */

const SEARCH_URL = 'https://api.github.com/search/issues';

/**
 * Excluded by name when no author allowlist is configured. With an allowlist, the bots are
 * excluded by construction and these qualifiers would be dead weight in the query.
 */
const DEPENDENCY_BOTS = ['app/dependabot', 'app/renovate', 'app/github-actions'];

/** Only `total_count` is read — the search hits themselves are never inspected. */
interface SearchResponse {
  total_count: number;
}

/**
 * The search query for one repo's merged PRs in the week.
 *
 * `merged:` accepts offset-bearing ISO timestamps, so GitHub enforces the window itself. That
 * matters: the search response's issue objects carry no top-level `merged_at`, so there is
 * nothing to post-filter on.
 */
export function buildSearchQuery(
  repo: RatioRepo,
  week: WeekWindow,
  authors: readonly string[],
): string {
  const qualifiers = [
    `repo:${repo.owner}/${repo.name}`,
    'is:pr',
    'is:merged',
    `merged:${week.start}..${week.end}`,
  ];

  if (authors.length > 0) {
    // GitHub ORs repeated `author:` qualifiers, so the allowlist is one query, not one per login.
    qualifiers.push(...authors.map((login) => `author:${login}`));
  } else {
    qualifiers.push(...DEPENDENCY_BOTS.map((bot) => `-author:${bot}`));
  }

  return qualifiers.join(' ');
}

/**
 * The search query for merged PRs OUTSIDE the configured repos — the "Other" bucket — or
 * `undefined` when there is no author allowlist to anchor it on.
 *
 * That guard is the whole design constraint: GitHub Search has no "everywhere except these
 * repos" without an anchoring qualifier, so `-repo:` exclusions alone would sweep the entire
 * public timeline. The `author:` allowlist is that anchor, which makes the bucket "your merged
 * PRs elsewhere". Without it the deployment simply doesn't measure Other, and the bar is
 * exactly what it was before.
 */
export function buildOtherQuery(
  repos: readonly RatioRepo[],
  week: WeekWindow,
  authors: readonly string[],
): string | undefined {
  if (authors.length === 0) return undefined;

  return [
    'is:pr',
    'is:merged',
    `merged:${week.start}..${week.end}`,
    ...authors.map((login) => `author:${login}`),
    // Negated qualifiers are ANDed, so every measured repo is subtracted from the sweep and
    // no PR can be counted both in its own segment and in Other.
    ...repos.map((repo) => `-repo:${repo.owner}/${repo.name}`),
  ].join(' ');
}

/**
 * Integer percentages summing to exactly 100, via largest-remainder (Hamilton) rounding:
 * floor every share, then hand the leftover points to the largest fractional remainders,
 * ties broken by input order. Naive per-segment rounding produces the classic "33% / 66%"
 * bar that visibly doesn't add up. All-zero input yields all zeros — not NaN, not an even
 * split, because a week with no merged PRs has no split to show.
 */
export function toPercentages(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((count) => (count / total) * 100);
  const percentages = exact.map((share) => Math.floor(share));
  let leftover = 100 - percentages.reduce((sum, share) => sum + share, 0);

  // `stableSorted` keeps the configured order among equal remainders, which is the tie-break.
  const byRemainder = stableSorted(
    exact.map((share, index) => ({ index, remainder: share - Math.floor(share) })),
    (a, b) => b.remainder - a.remainder,
  );

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    percentages[index] = (percentages[index] ?? 0) + 1;
    leftover -= 1;
  }

  return percentages;
}

/** One query's merged-PR count, or `undefined` when GitHub wouldn't say. */
async function countMergedPrs(
  searchQuery: string,
  config: PrRatioConfig,
): Promise<number | undefined> {
  const query = new URLSearchParams({
    q: searchQuery,
    // Only `total_count` is read; asking for one item keeps the payload tiny.
    per_page: '1',
  });

  try {
    const response = await fetch(`${SEARCH_URL}?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub rejects API requests with no User-Agent.
        'User-Agent': 'alfred',
      },
      // Search is capped at 30 req/min. Five minutes makes repeated Backlog visits free
      // while keeping a weekly metric current enough.
      next: { revalidate: 300 },
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as SearchResponse;
    return typeof data.total_count === 'number' ? data.total_count : undefined;
  } catch {
    // A network failure is the same outcome as a 5xx here: no trustworthy count.
    return undefined;
  }
}

/**
 * The week's split across every configured repo — plus the "Other" bucket for everything
 * merged outside them, when the config can anchor that sweep — or `undefined` when ANY
 * request failed. Partial results are deliberately discarded: a bar whose segments were
 * counted under different rules is a *wrong* ratio, and showing nothing beats showing that.
 * Other is a segment like any other here, so its failure sinks the call too.
 *
 * Every query is issued in parallel — sequential round-trips would multiply the component's
 * time-to-content for no reason — and Other goes last so it sits at the end of the bar.
 */
export async function fetchPrRatio(
  config: PrRatioConfig,
  week: WeekWindow,
): Promise<PrRatioResponse | undefined> {
  const otherQuery = buildOtherQuery(config.repos, week, config.authors);
  const queries = config.repos.map((repo) => buildSearchQuery(repo, week, config.authors));
  if (otherQuery !== undefined) queries.push(otherQuery);

  const counts = await Promise.all(queries.map((query) => countMergedPrs(query, config)));
  if (counts.includes(undefined)) return undefined;

  const resolved = counts.map((count) => count ?? 0);
  const percentages = toPercentages(resolved);
  const otherIndex = config.repos.length;

  return {
    week,
    total: resolved.reduce((sum, count) => sum + count, 0),
    repos: config.repos.map((repo, index) => ({
      repo: `${repo.owner}/${repo.name}`,
      label: repo.label,
      count: resolved[index] ?? 0,
      percentage: percentages[index] ?? 0,
    })),
    ...(otherQuery !== undefined && {
      other: {
        count: resolved[otherIndex] ?? 0,
        percentage: percentages[otherIndex] ?? 0,
      },
    }),
  };
}
