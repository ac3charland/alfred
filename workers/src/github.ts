/**
 * Fetch a spec file from a project repo via the GitHub Contents API (code-module §13.3).
 *
 * On refinement-merge the Worker snapshots the spec into Supabase so the detail modal renders it
 * instantly, offline, and without a GitHub token at view time (§10). We read it with a
 * fine-grained PAT (Contents:read) pinned to the merge SHA so the snapshot is exactly what merged.
 */

export interface GithubEnv {
  GITHUB_TOKEN: string;
}

export interface FetchedSpec {
  markdown: string;
  /** The blob sha GitHub reports — stored alongside the markdown for drift detection (§10). */
  sha: string;
}

/** The subset of the Contents API response we use. `content` is base64 (with newlines). */
interface ContentsResponse {
  content: string;
  encoding: string;
  sha: string;
}

/** Decode GitHub's newline-wrapped base64 into a UTF-8 string. */
function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replaceAll(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

/**
 * GET `/repos/{owner}/{name}/contents/{path}?ref={sha}` and return the decoded markdown + sha.
 * Returns `undefined` when the file can't be fetched (missing, bad ref, auth) so the caller can
 * fall back to the live "view in repo" link rather than failing the whole webhook — the state
 * transition has already been recorded; the snapshot is best-effort.
 */
export async function fetchSpec(
  env: GithubEnv,
  owner: string,
  name: string,
  specPath: string,
  ref: string,
): Promise<FetchedSpec | undefined> {
  const path = specPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub rejects API requests with no User-Agent.
      'User-Agent': 'alfred-software-factory',
    },
  });

  if (!response.ok) return undefined;

  const data = await response.json<ContentsResponse>();
  if (data.encoding !== 'base64') return undefined;

  return { markdown: decodeBase64Utf8(data.content), sha: data.sha };
}
