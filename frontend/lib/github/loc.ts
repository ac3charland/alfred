import 'server-only';

import type { LocVelocityResponse, LocWeek } from '@/lib/types';

import type { GithubRepoConfig, RatioRepo } from './config';
import { DEPENDENCY_BOTS } from './pr-ratio';

/**
 * Lines changed per calendar week across the configured repos, counted live from GitHub's
 * pre-aggregated contributor statistics.
 *
 * `server-only`: the fan-out carries the fine-grained PAT, so importing this from a Client
 * Component is a build error rather than a leaked token.
 *
 * The metric is CHURN — additions plus deletions — not net growth. A week spent deleting a
 * dead module or rewriting a component nets out near zero while being the busiest week of the
 * month; net growth honestly measures codebase size and misleadingly measures velocity.
 *
 * It is scoped to the same authors the PR ratio counts, because the two widgets sit in the
 * same card stack: if the chart counted Dependabot and the bar beside it didn't, the page
 * would disagree with itself about whose work counts.
 */

const STATS_URL_TEMPLATE = (repo: RatioRepo): string =>
  `https://api.github.com/repos/${repo.owner}/${repo.name}/stats/contributors`;

const MS_PER_DAY = 86_400_000;
const SECONDS_PER_WEEK = 604_800;

/** Weeks drawn on the chart — twelve bars stay wide enough to read at phone width. */
export const HISTORY_WEEKS = 12;

/** The trailing window the average line is taken over: reacts inside a month. */
export const ROLLING_AVERAGE_WEEKS = 4;

/**
 * Weeks actually read from GitHub. A true four-week mean needs three weeks of history BEFORE
 * the first drawn bar — without them the line's first three points are means of one, two and
 * three weeks, which reads as a spurious ramp that never happened.
 */
const READ_WEEKS = HISTORY_WEEKS + ROLLING_AVERAGE_WEEKS - 1;

/**
 * These hit the 5 000/hr core limit rather than Search's 30/min, and a weekly bucket cannot
 * move faster than a push, so an hour-old answer is as true as a fresh one.
 */
const CACHE_SECONDS = 3600;

/** GitHub computes contributor statistics asynchronously and says so with a bodyless 202. */
const COMPUTING_STATUS = 202;

/** One contributor's weekly buckets, as `stats/contributors` returns them. */
interface ContributorStats {
  /** `null` for commits GitHub cannot map to an account (an unrecognised commit email). */
  author: { login: string } | null;
  /** Optional on the wire: a contributor row can arrive with no buckets at all. */
  weeks?: ContributorWeek[];
}

interface ContributorWeek {
  /** Unix SECONDS of the week's Sunday 00:00 UTC. */
  w: number;
  /** Additions. */
  a: number;
  /**
   * Deletions, as a POSITIVE count. The sibling `stats/code_frequency` endpoint returns them
   * negative; copying that sign convention here would silently subtract deletions from churn.
   */
  d: number;
  c: number;
}

/** What one repo's statistics request produced. */
type RepoStats =
  | { status: 'ready'; contributors: ContributorStats[] }
  | { status: 'computing' }
  | { status: 'failed' };

/** The whole fan-out's outcome — the three the Route Handler maps to 200 / 202 / 502. */
export type LocVelocityOutcome =
  | { status: 'ready'; velocity: LocVelocityResponse }
  | { status: 'computing' }
  | { status: 'failed' };

/**
 * Unix seconds of the Sunday 00:00 UTC that opens the calendar week containing `now` — the
 * same anchor GitHub buckets on, so a bucket key matches a `weeks[].w` exactly.
 *
 * GitHub does the bucketing and it is not negotiable: a local-timezone re-bucket is impossible
 * without per-commit data, so the whole series is anchored and formatted in UTC.
 */
export function weekStartSeconds(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (midnight - now.getUTCDay() * MS_PER_DAY) / 1000;
}

/** '2026-09-06' for a week-start timestamp — UTC, like the bucket it names. */
function toIsoDate(weekStart: number): string {
  return new Date(weekStart * 1000).toISOString().slice(0, 10);
}

/**
 * A dependency bot's login, derived from the search qualifier the PR ratio keeps. The two
 * endpoints spell the same bot differently: Search wants `app/dependabot`, a contributor row
 * carries the login `dependabot[bot]`.
 */
const BOT_LOGINS = new Set(
  DEPENDENCY_BOTS.map((qualifier) => qualifier.replace(/^app\//, '').toLowerCase()),
);

function isDependencyBot(login: string): boolean {
  return BOT_LOGINS.has(login.replace(/\[bot]$/i, '').toLowerCase());
}

/**
 * Whether a contributor's lines count. An allowlist is exact (and case-insensitive, since
 * GitHub logins are); an empty allowlist means "anyone", which still excludes the known
 * dependency bots by name and keeps the unattributable rows — under an allowlist those rows
 * cannot match and drop out on their own, which is the right answer there.
 */
export function countsAuthor(login: string | null, authors: readonly string[]): boolean {
  if (authors.length > 0) {
    return (
      login !== null && authors.some((allowed) => allowed.toLowerCase() === login.toLowerCase())
    );
  }
  return login === null || !isDependencyBot(login);
}

/** One repo's contributor statistics, or the outcome that stopped them arriving. */
async function fetchRepoStats(repo: RatioRepo, config: GithubRepoConfig): Promise<RepoStats> {
  try {
    const response = await fetch(STATS_URL_TEMPLATE(repo), {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub rejects API requests with no User-Agent.
        'User-Agent': 'alfred',
      },
      next: { revalidate: CACHE_SECONDS },
    });

    // A cold cache answers 202 with no body, commonly on the first-ever request for a repo.
    // Calling that an error shows "couldn't load" for something that will work in a minute;
    // calling it success shows a chart of zeros, which is a lie. It gets its own outcome.
    if (response.status === COMPUTING_STATUS) return { status: 'computing' };
    if (!response.ok) return { status: 'failed' };

    const contributors = (await response.json()) as unknown;
    if (!Array.isArray(contributors)) return { status: 'failed' };
    return { status: 'ready', contributors: contributors as ContributorStats[] };
  } catch {
    // A network failure is the same outcome as a 5xx here: no trustworthy count.
    return { status: 'failed' };
  }
}

/**
 * The churn each of the last {@link READ_WEEKS} weeks carries, oldest first. Buckets are built
 * from the current Sunday backwards and default to zero, so a quiet week and a week before a
 * repo existed both come out as a real zero rather than a hole in the series.
 */
function bucketLines(
  repoStats: readonly ContributorStats[][],
  authors: readonly string[],
  currentWeek: number,
): { week: number; lines: number }[] {
  // Built oldest-first so the series comes out ordered by construction — no sort to get wrong,
  // and no hole where a quiet week or a not-yet-existing repo contributed nothing.
  const weekStarts = Array.from(
    { length: READ_WEEKS },
    (_, index) => currentWeek - (READ_WEEKS - 1 - index) * SECONDS_PER_WEEK,
  );
  const buckets = new Map<number, number>(weekStarts.map((week) => [week, 0]));

  for (const contributors of repoStats) {
    for (const contributor of contributors) {
      if (!countsAuthor(contributor.author?.login ?? null, authors)) continue;
      for (const week of contributor.weeks ?? []) {
        const running = buckets.get(week.w);
        if (running === undefined) continue;
        // `d` is positive here — churn ADDS deletions. `Math.abs` holds the convention even if
        // a future payload borrows `code_frequency`'s negative sign.
        buckets.set(week.w, running + week.a + Math.abs(week.d));
      }
    }
  }

  return weekStarts.map((week) => ({ week, lines: buckets.get(week) ?? 0 }));
}

/**
 * The {@link HISTORY_WEEKS} weeks the chart draws, each carrying its trailing mean.
 *
 * The newest bucket is the week still in progress: it is drawn (it is real work) but flagged
 * `partial`, and its average is `null` so the trend line stops at the last COMPLETE week
 * rather than being dragged to the floor by a Monday reading.
 */
export function toWeeks(series: readonly { week: number; lines: number }[]): LocWeek[] {
  const lastIndex = series.length - 1;

  return series.slice(-HISTORY_WEEKS).map((bucket, offset) => {
    const index = series.length - HISTORY_WEEKS + offset;
    const partial = index === lastIndex;
    const window = series.slice(index - ROLLING_AVERAGE_WEEKS + 1, index + 1);
    const mean = window.reduce((sum, entry) => sum + entry.lines, 0) / window.length;

    return {
      week: toIsoDate(bucket.week),
      lines: bucket.lines,
      average: partial ? null : Math.round(mean),
      partial,
    };
  });
}

/**
 * The velocity series across every configured repo, or the outcome that stopped it.
 *
 * Any repo failing sinks the whole response, exactly as `fetchPrRatio` discards a partial
 * ratio: a velocity number missing one repo's lines is a WRONG number, and showing nothing
 * beats showing that. Any repo still computing makes the whole answer "still computing", since
 * the alternative is a chart that silently under-counts.
 *
 * Every repo is asked in parallel — sequential round-trips would multiply the card's
 * time-to-content for no reason.
 */
export async function fetchLocVelocity(
  config: GithubRepoConfig,
  now: Date,
): Promise<LocVelocityOutcome> {
  const results = await Promise.all(config.repos.map((repo) => fetchRepoStats(repo, config)));

  if (results.some((result) => result.status === 'failed')) return { status: 'failed' };
  if (results.some((result) => result.status === 'computing')) return { status: 'computing' };

  const contributors = results.map((result) =>
    result.status === 'ready' ? result.contributors : [],
  );
  const series = bucketLines(contributors, config.authors, weekStartSeconds(now));

  return {
    status: 'ready',
    velocity: {
      weeks: toWeeks(series),
      repos: config.repos.map((repo) => `${repo.owner}/${repo.name}`),
      authors: [...config.authors],
      averageWeeks: ROLLING_AVERAGE_WEEKS,
    },
  };
}
