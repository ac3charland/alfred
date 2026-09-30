import type { Project } from '@/lib/types';

/**
 * GitHub measurement configuration: which repos to measure, and with what. Shared by the two
 * widgets on the Code Dashboard — the merged-PR ratio and the lines-changed-per-week chart. One
 * repo set feeds both, so the two measurements on one page cover the same ground. The author
 * allowlist is the RATIO's alone — it names who opens a pull request, which says nothing about
 * who authored the commits the velocity chart counts (see `loc.ts`).
 *
 * The measured repos ARE the Code module's projects: every `projects` row is one measured repo,
 * labelled by the project's name, in the creation order the caller read them in. So a project
 * reads the same on the ratio bar as in ProjectNav, and a new project is measured without a
 * redeploy. A repo the owner ships to that is not a project has no segment of its own: its
 * merged PRs land in "Other", and only when `PR_RATIO_AUTHORS` is set to anchor that sweep.
 * `GITHUB_TOKEN` must be able to read every project's repo — one it can't read fails the whole
 * fan-out, since a partial ratio is a wrong ratio.
 *
 * The one exception is the ratio's alone: a project flagged `exclude_from_pr_ratio` leaves the
 * ratio's measured repos (no segment, no share of the total) yet is still subtracted from Other,
 * so its PRs vanish rather than resurfacing there. The velocity chart measures it regardless.
 *
 * Kept DB-free: the caller reads the project rows (with whichever Supabase client its auth
 * resolved to) and hands them in, so this stays a pure function of env plus rows.
 *
 * `PR_RATIO_AUTHORS` under-describes its widened scope (it also anchors Other, and shares a
 * config with the velocity chart), but renaming it means a coordinated deployment env change
 * for zero functional gain.
 *
 * Nothing here is `NEXT_PUBLIC_` — above all the token, which must never reach the browser.
 */

/** A measurement needs somewhere to measure; below this the feature reports itself unconfigured. */
const MINIMUM_REPOS = 1;

/** Fewer than this many repos is not a ratio, so the RATIO reports itself unconfigured. */
const MINIMUM_RATIO_REPOS = 2;

export interface RatioRepo {
  /** GitHub owner, e.g. 'ac3charland'. */
  owner: string;
  /** GitHub repo name, e.g. 'realplay'. */
  name: string;
  /** Display label for the bar segment — the project's name. */
  label: string;
}

export interface GithubRepoConfig {
  /** The measured repos, in project creation order — which is the bar's left-to-right order. */
  repos: RatioRepo[];
  /**
   * GitHub logins whose merged PRs count; empty means "anyone but the known bots". Also the
   * anchor for the "Other" bucket — empty leaves that segment unmeasured, since a sweep of
   * everything outside `repos` needs some qualifier to bound it.
   */
  authors: string[];
  /** Fine-grained PAT with read access to every project's repo. */
  token: string;
}

/**
 * The ratio's config: the shared one, gated by a stricter project minimum, with the owner-excluded
 * projects split out of `repos` — which holds only the counted ones.
 */
export type PrRatioConfig = GithubRepoConfig & {
  /**
   * Projects excluded from the ratio, in creation order. Never searched for, but still subtracted
   * from the Other sweep so their PRs don't reappear there.
   */
  excludedRepos: RatioRepo[];
};

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

/** The project columns a measurement needs, in the order the caller read them. */
export type MeasuredProject = Pick<
  Project,
  'name' | 'repo_owner' | 'repo_name' | 'exclude_from_pr_ratio'
>;

/**
 * The shared base both widgets read: a token plus at least one project, or `undefined` when
 * the deployment has neither. Repos keep the given order — the caller reads projects oldest
 * first, the order `projectColorFor` indexes, so the bar's order is its colour order. Every project
 * counts here, excluded from the ratio or not. Never throws.
 */
export function getGithubRepoConfig(
  projects: readonly MeasuredProject[],
): GithubRepoConfig | undefined {
  const token = envValue(process.env.GITHUB_TOKEN);
  if (token === undefined || projects.length < MINIMUM_REPOS) return undefined;

  const repos = projects.map((project) => ({
    owner: project.repo_owner,
    name: project.repo_name,
    label: project.name,
  }));
  return { repos, authors: splitList(envValue(process.env.PR_RATIO_AUTHORS)), token };
}

/**
 * The ratio's stricter view of the same config: a split needs at least two repos to be a
 * split, so a one-project deployment gets the velocity chart and no ratio bar.
 *
 * The minimum counts every project, BEFORE exclusion. Excluding projects therefore never makes the
 * ratio unconfigured — which would take the card, and the menu that un-excludes them, off the
 * Dashboard. Two projects with one excluded draw a one-project bar; all excluded, an empty one.
 */
export function getPrRatioConfig(projects: readonly MeasuredProject[]): PrRatioConfig | undefined {
  const config = getGithubRepoConfig(projects);
  if (config === undefined || config.repos.length < MINIMUM_RATIO_REPOS) return undefined;

  // `config.repos` is `projects` mapped one-to-one, so the indexes line up.
  const excluded = (index: number) => projects[index]?.exclude_from_pr_ratio === true;
  return {
    ...config,
    repos: config.repos.filter((_, index) => !excluded(index)),
    excludedRepos: config.repos.filter((_, index) => excluded(index)),
  };
}
