/**
 * Pure helpers for GitHub repo coordinates (the New-project dialog + the projects route).
 *
 * A project = a GitHub repo (§3). The user pastes a repo URL; we derive `repo_owner` /
 * `repo_name` from it and store the URL too (the owner/name pair is the source of truth,
 * §4.2). Kept dependency-free so it's trivially unit-tested and reused server-side.
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
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const rawName = segments[1];
  if (owner === undefined || rawName === undefined) return null;

  const name = rawName.replace(/\.git$/, '');
  if (owner.length === 0 || name.length === 0) return null;

  return { owner, name };
}
