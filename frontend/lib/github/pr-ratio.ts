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

/** One repo's merged-PR count for the week, or `undefined` when GitHub wouldn't say. */
async function countMergedPrs(
  repo: RatioRepo,
  week: WeekWindow,
  config: PrRatioConfig,
): Promise<number | undefined> {
  const query = new URLSearchParams({
    q: buildSearchQuery(repo, week, config.authors),
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
 * The week's split across every configured repo, or `undefined` when ANY repo's request
 * failed. Partial results are deliberately discarded: a bar whose segments were counted
 * under different rules is a *wrong* ratio, and showing nothing beats showing that.
 *
 * The repos are queried in parallel — two sequential round-trips would double the
 * component's time-to-content for no reason.
 */
export async function fetchPrRatio(
  config: PrRatioConfig,
  week: WeekWindow,
): Promise<PrRatioResponse | undefined> {
  const counts = await Promise.all(config.repos.map((repo) => countMergedPrs(repo, week, config)));
  if (counts.includes(undefined)) return undefined;

  const resolved = counts.map((count) => count ?? 0);
  const percentages = toPercentages(resolved);

  return {
    week,
    total: resolved.reduce((sum, count) => sum + count, 0),
    repos: config.repos.map((repo, index) => ({
      repo: `${repo.owner}/${repo.name}`,
      label: repo.label,
      count: resolved[index] ?? 0,
      percentage: percentages[index] ?? 0,
    })),
  };
}
