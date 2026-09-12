/**
 * GitHub measurement configuration, read from environment. Shared by the two widgets on the
 * Code Dashboard: the merged-PR ratio and the lines-changed-per-week chart. One repo set and
 * one author set feed both, so the two measurements on one page share a denominator.
 *
 * The measured repos are env-configured rather than read from the `projects` table on
 * purpose: not every repo the owner ships to runs through the Software Factory, and adding
 * one as a project row would surface it in every project nav, board and epic picker in the
 * Code module. Each var is read by its literal name (never a computed key), mirroring
 * `lib/instance.ts`.
 *
 * `PR_RATIO_REPOS` / `PR_RATIO_AUTHORS` under-describe that widened scope, but renaming them
 * means a coordinated deployment env change for zero functional gain — and a half-done rename
 * leaves a deployment with an unconfigured dashboard.
 *
 * Nothing here is `NEXT_PUBLIC_` — above all the token, which must never reach the browser.
 */

/** `owner/name` with an optional `:Label` suffix; surrounding whitespace is tolerated. */
const REPO_ENTRY = /^\s*([\w.-]+)\/([\w.-]+)\s*(?::\s*(.+?)\s*)?$/;

/** A measurement needs somewhere to measure; below this the feature reports itself unconfigured. */
const MINIMUM_REPOS = 1;

/** Fewer than this many repos is not a ratio, so the RATIO reports itself unconfigured. */
const MINIMUM_RATIO_REPOS = 2;

export interface RatioRepo {
  /** GitHub owner, e.g. 'ac3charland'. */
  owner: string;
  /** GitHub repo name, e.g. 'realplay'. */
  name: string;
  /** Display label for the bar segment; defaults to `name` when the suffix is omitted. */
  label: string;
}

export interface GithubRepoConfig {
  /** The measured repos, in configured order — which is the bar's left-to-right order. */
  repos: RatioRepo[];
  /**
   * GitHub logins whose merged PRs count; empty means "anyone but the known bots". Also the
   * anchor for the "Other" bucket — empty leaves that segment unmeasured, since a sweep of
   * everything outside `repos` needs some qualifier to bound it.
   */
  authors: string[];
  /** Fine-grained PAT with read access to the measured repos. */
  token: string;
}

/**
 * The ratio's config is the shared one under a stricter repo minimum — a distinct type so a
 * caller can't hand `fetchPrRatio` a single-repo config the bar has no split to draw from.
 */
export type PrRatioConfig = GithubRepoConfig;

/** Trim and collapse a blank env value to `undefined`, so `??` defaults treat "" as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') {
    return undefined;
  }
  return trimmed;
}

/** Split a comma-separated env list into trimmed, non-empty entries. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function parseRepo(entry: string): RatioRepo | undefined {
  const match = REPO_ENTRY.exec(entry);
  if (!match) return undefined;
  const [, owner, name, label] = match;
  if (owner === undefined || name === undefined) return undefined;
  return { owner, name, label: label ?? name };
}

/**
 * The shared base both widgets read: a token plus at least one well-formed repo, or
 * `undefined` when the deployment has configured neither. A malformed entry is skipped rather
 * than fatal, so one typo degrades a widget instead of breaking the view around it. Never throws.
 */
export function getGithubRepoConfig(): GithubRepoConfig | undefined {
  const token = envValue(process.env.GITHUB_TOKEN);
  if (token === undefined) return undefined;

  const repos = splitList(envValue(process.env.PR_RATIO_REPOS))
    .map((entry) => parseRepo(entry))
    .filter((repo): repo is RatioRepo => repo !== undefined);
  if (repos.length < MINIMUM_REPOS) return undefined;

  return { repos, authors: splitList(envValue(process.env.PR_RATIO_AUTHORS)), token };
}

/**
 * The ratio's stricter view of the same config: a split needs at least two repos to be a
 * split, so a one-repo deployment gets the velocity chart and no ratio bar.
 */
export function getPrRatioConfig(): PrRatioConfig | undefined {
  const config = getGithubRepoConfig();
  if (config === undefined || config.repos.length < MINIMUM_RATIO_REPOS) return undefined;
  return config;
}
