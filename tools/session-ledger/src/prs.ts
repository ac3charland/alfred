import { parseFrontmatter } from '../../../workers/src/frontmatter.ts';
import type { AlfredFrontmatter } from '../../../workers/src/frontmatter.ts';
import { sortedBy } from './sort.ts';

/**
 * Pull requests: which PR each session produced, and the `alfred` block that PR carries. Read
 * from GitHub's REST list (the descriptions come with it, about five pages for this repo), or
 * from a file holding the same JSON when the caller fetched it another way.
 */

/** The fields of a REST pull-request object this tool reads. */
export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  body: string | null;
  head: { sha: string };
}

export interface SessionLink {
  pr: PullRequest;
  /** The PR's parsed `alfred` block; `undefined` for a PR without a parseable one. */
  block: AlfredFrontmatter | undefined;
  /** Every other PR that also links this session, by number. */
  extraPrs: number[];
}

const SESSION_LINK_RE = /claude\.ai\/code\/(session_[A-Za-z0-9]+)/g;

/** Every distinct session a PR description links, in order of first appearance. */
export function sessionIdsIn(body: string | null): string[] {
  return [...new Set([...(body ?? '').matchAll(SESSION_LINK_RE)].map((match) => match[1] ?? ''))];
}

export function prState(pr: PullRequest): 'merged' | 'closed' | 'open' {
  if (pr.merged_at !== null) return 'merged';
  return pr.state === 'open' ? 'open' : 'closed';
}

/**
 * Session id → the PR that owns its row. When several PRs link one session, the earliest-created
 * PR with an `alfred` block owns it (the earliest PR of all when none has one), and the rest are
 * recorded as extras. When one PR links several sessions, each gets its own link to that PR.
 */
export function linkSessions(pulls: readonly PullRequest[]): Map<string, SessionLink> {
  const candidates = new Map<string, PullRequest[]>();
  for (const pr of pulls) {
    for (const id of sessionIdsIn(pr.body)) {
      candidates.set(id, [...(candidates.get(id) ?? []), pr]);
    }
  }

  const links = new Map<string, SessionLink>();
  for (const [id, prs] of candidates) {
    const byAge = sortedBy(
      prs,
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number,
    );
    const owner = byAge.find((pr) => parseFrontmatter(pr.body ?? '') !== undefined) ?? byAge[0];
    if (owner === undefined) continue;
    links.set(id, {
      pr: owner,
      block: parseFrontmatter(owner.body ?? ''),
      extraPrs: sortedBy(
        byAge.filter((pr) => pr !== owner).map((pr) => pr.number),
        (a, b) => a - b,
      ),
    });
  }
  return links;
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const PER_PAGE = 100;

/**
 * Every PR in `repo` (open and closed), paging until a short page. Sends `GITHUB_TOKEN` when one
 * is given; unauthenticated calls share the host's rate limit. A failed page throws — a partial
 * list would silently turn PR-linked sessions into `no_pr` rows.
 */
export async function fetchPulls(
  repo: string,
  {
    fetchFn = fetch,
    token,
    apiUrl = 'https://api.github.com',
  }: { fetchFn?: FetchLike; token?: string | undefined; apiUrl?: string } = {},
): Promise<PullRequest[]> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'alfred-session-ledger',
  };
  if (token !== undefined && token !== '') headers['authorization'] = `Bearer ${token}`;

  const pulls: PullRequest[] = [];
  for (let page = 1; ; page += 1) {
    const url = `${apiUrl}/repos/${repo}/pulls?state=all&per_page=${String(PER_PAGE)}&page=${String(page)}`;
    const response = await fetchFn(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub answered ${String(response.status)} for ${url}`);
    }
    const batch = (await response.json()) as PullRequest[];
    pulls.push(...batch);
    if (batch.length < PER_PAGE) return pulls;
  }
}
