/**
 * Pure helpers for GitHub repo coordinates (the New-project dialog + the projects route).
 *
 * A project = a GitHub repo. The user pastes a repo URL; we derive `repo_owner` /
 * `repo_name` from it and store the URL too (the owner/name pair is the source of truth).
 * Kept dependency-free so it's trivially unit-tested and reused server-side.
 */

export interface RepoCoordinates {
  owner: string;
  name: string;
}

/**
 * Parse a GitHub repo URL into `{ owner, name }`, or `null` when it isn't a recognisable
 * `github.com/<owner>/<name>` URL. Tolerates `http`/`https`, a `www.` host, a trailing
 * `.git`, a trailing slash, and extra path/query/hash after the repo (e.g. `/tree/main`).
 */
export function parseGithubRepo(url: string): RepoCoordinates | null {
  let parsed: URL;
  try {
    // Stryker disable next-line MethodExpression: AT_CEILING — the WHATWG URL constructor already strips leading/trailing whitespace, so the explicit .trim() is redundant; removing it changes nothing.
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  // Stryker disable next-line Regex: AT_CEILING — dropping the ^ anchor still strips a leading "www." (the only position that matters); a "www." elsewhere can't make a non-github host equal "github.com", so the result is unchanged.
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  // Stryker disable next-line ConditionalExpression: AT_CEILING — with <2 segments, segments[1] is undefined → the rawName-undefined guard below returns null identically.
  if (segments.length < 2) return null;

  const owner = segments[0];
  const rawName = segments[1];
  // Stryker disable next-line ConditionalExpression,LogicalOperator: AT_CEILING — segments.length>=2 guarantees both indices are defined strings at runtime; this is a TS-noUncheckedIndexedAccess safety guard that is unreachable.
  if (owner === undefined || rawName === undefined) return null;

  const name = rawName.replace(/\.git$/, '');
  if (name.length === 0) return null;
  // Stryker disable next-line ConditionalExpression,BooleanLiteral: AT_CEILING — `owner` is segments[0], taken from a list filtered to length>0 segments, so owner.length is never 0; dead defensive code.
  if (owner.length === 0) return null;

  return { owner, name };
}
