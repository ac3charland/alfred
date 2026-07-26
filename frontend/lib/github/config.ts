/**
 * PR-ratio configuration, read from environment.
 *
 * The measured repos are env-configured rather than read from the `projects` table on
 * purpose: not every repo the owner ships to runs through the Software Factory, and adding
 * one as a project row would surface it in every project nav, board and epic picker in the
 * Code module. Each var is read by its literal name (never a computed key), mirroring
 * `lib/instance.ts`.
 *
 * Nothing here is `NEXT_PUBLIC_` — above all the token, which must never reach the browser.
 */

/** `owner/name` with an optional `:Label` suffix; surrounding whitespace is tolerated. */
const REPO_ENTRY = /^\s*([\w.-]+)\/([\w.-]+)\s*(?::\s*(.+?)\s*)?$/;

/** Fewer than this many repos is not a ratio, so the feature reports itself unconfigured. */
const MINIMUM_REPOS = 2;

export interface RatioRepo {
  /** GitHub owner, e.g. 'ac3charland'. */
  owner: string;
  /** GitHub repo name, e.g. 'realplay'. */
  name: string;
  /** Display label for the bar segment; defaults to `name` when the suffix is omitted. */
  label: string;
}

export interface PrRatioConfig {
  /** The measured repos, in configured order — which is the bar's left-to-right order. */
  repos: RatioRepo[];
  /**
   * GitHub logins whose merged PRs count; empty means "anyone but the known bots". Also the
   * anchor for the "Other" bucket — empty leaves that segment unmeasured, since a sweep of
   * everything outside `repos` needs some qualifier to bound it.
   */
  authors: string[];
  /** Fine-grained PAT with Pull requests: read on the measured repos. */
  token: string;
}

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
 * Returns the parsed config, or `undefined` when the feature is not configured (no token, or
 * fewer than two well-formed repo entries). A malformed entry is skipped rather than fatal,
 * so one typo degrades the ratio instead of breaking the Backlog. Never throws.
 */
export function getPrRatioConfig(): PrRatioConfig | undefined {
  const token = envValue(process.env.GITHUB_TOKEN);
  if (token === undefined) return undefined;

  const repos = splitList(envValue(process.env.PR_RATIO_REPOS))
    .map((entry) => parseRepo(entry))
    .filter((repo): repo is RatioRepo => repo !== undefined);
  if (repos.length < MINIMUM_REPOS) return undefined;

  return { repos, authors: splitList(envValue(process.env.PR_RATIO_AUTHORS)), token };
}
