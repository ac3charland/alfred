import 'server-only';

import type { WikiConfig } from './config';
import type { Envelope } from './envelope';
import { folderName, uniqueFolderName } from './paths';

/**
 * One send is one commit: every envelope's files land on the wiki's `main` in a single commit
 * through GitHub's Git Data API, then `main` is fast-forwarded to it.
 *
 * Why not the Contents API: it writes one file per commit, and a Reader send has two files. Its
 * first commit already touches `inbox/**`, which starts the wiki's kickoff — and kickoff can then
 * take its lock with only half the folder in the batch while the second file lands in a folder
 * that is being moved. One tree, one commit closes that gap, at the cost of a few more requests
 * and a retry loop for when `main` moves underneath us.
 *
 * `fetch` is injectable so the unit tests script every response; the Playwright harness instead
 * points `WIKI_GITHUB_API_URL` at its mock server.
 */

export type WikiWriteErrorKind = 'unauthorized' | 'rejected' | 'busy' | 'unreachable';

/**
 * A failed send, classified for the route's status mapping. The message names the step and the
 * status, never the request body or a header, so the token cannot leak through an error.
 */
export class WikiWriteError extends Error {
  constructor(
    readonly kind: WikiWriteErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'WikiWriteError';
  }
}

/** The folder every send lands in. */
const INBOX = 'inbox';

/** How many times a send is attempted in total when `main` keeps moving. */
export const MAX_COMMIT_ATTEMPTS = 3;

export interface CommitResult {
  /** The commit `main` now points at. */
  commitSha: string;
  /** The `inbox/<name>` folder each envelope was committed under, in envelope order. */
  folders: string[];
}

export interface CommitOptions {
  /** Injected for tests; defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

/** A tree entry as the Git Data API lists it. */
interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

/** A fetch that never throws a raw error: a network failure becomes `unreachable`. */
async function send(
  config: WikiConfig,
  fetchImpl: typeof globalThis.fetch,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API requests with no User-Agent.
    'User-Agent': 'alfred-wiki',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetchImpl(`${config.apiUrl}/repos/${config.owner}/${config.name}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new WikiWriteError('unreachable', `wiki: ${method} ${path} did not reach GitHub`);
  }
}

/**
 * The failure a non-2xx answer is. A 401 or 403 is the token (missing, expired, or not scoped to
 * the repo); everything else is GitHub refusing the request as made — a malformed tree, a missing
 * ref — which no retry can fix. A 422 on the ref update is the ONE retryable case, and the caller
 * decides that, so it is not classified here.
 */
function failure(method: string, path: string, response: Response): WikiWriteError {
  const kind = response.status === 401 || response.status === 403 ? 'unauthorized' : 'rejected';
  return new WikiWriteError(kind, `wiki: ${method} ${path} answered ${String(response.status)}`);
}

/**
 * Perform one request and parse its JSON body, throwing the classified error on non-2xx. A 2xx
 * whose body cannot be read at all — a connection reset partway through, or a body that isn't
 * JSON — is `unreachable`, the same family as never getting an answer: nothing about the request
 * was rejected, the answer just never fully arrived.
 */
async function call<T>(
  config: WikiConfig,
  fetchImpl: typeof globalThis.fetch,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await send(config, fetchImpl, method, path, body);
  if (!response.ok) throw failure(method, path, response);
  try {
    return (await response.json()) as T;
  } catch {
    throw new WikiWriteError(
      'unreachable',
      `wiki: ${method} ${path} answered but its body could not be read`,
    );
  }
}

/**
 * A required field out of a parsed GitHub answer, or a `rejected` failure — a well-formed
 * response never lacks its documented shape, so a missing field here means GitHub answered with
 * something this code was never built to read, not that the request itself was wrong.
 */
function field<T>(value: T | null | undefined, method: string, path: string, name: string): T {
  if (value === null || value === undefined) {
    throw new WikiWriteError('rejected', `wiki: ${method} ${path} answered without ${name}`);
  }
  return value;
}

/** The names already taken under `inbox/` at `treeSha`, or none when the folder doesn't exist. */
async function takenInboxNames(
  config: WikiConfig,
  fetchImpl: typeof globalThis.fetch,
  treeSha: string,
): Promise<Set<string>> {
  const rootPath = `/git/trees/${treeSha}`;
  const root = await call<{ tree?: TreeEntry[] }>(config, fetchImpl, 'GET', rootPath);
  const rootTree = field(root.tree, 'GET', rootPath, 'tree');
  const inbox = rootTree.find((entry) => entry.path === INBOX && entry.type === 'tree');
  if (inbox === undefined) return new Set();
  const listingPath = `/git/trees/${inbox.sha}`;
  const listing = await call<{ tree?: TreeEntry[] }>(config, fetchImpl, 'GET', listingPath);
  const listingTree = field(listing.tree, 'GET', listingPath, 'tree');
  return new Set(listingTree.map((entry) => entry.path));
}

/**
 * Name each envelope's folder: `<captured>-<slug>`, made unique against the names already in
 * `inbox/` AND against the other folders of this same commit. Two envelopes that slug alike land
 * as `…` and `…-2`, never as one merged folder.
 */
function nameFolders(envelopes: readonly Envelope[], taken: ReadonlySet<string>): string[] {
  const claimed = new Set(taken);
  return envelopes.map((envelope) => {
    const name = uniqueFolderName(folderName(envelope.captured, envelope.title), claimed);
    claimed.add(name);
    return name;
  });
}

/** `add: <title>` for one folder, `add: <n> sources` for several — the wiki's own `npm run add`. */
export function commitMessage(envelopes: readonly Envelope[]): string {
  const [only] = envelopes;
  return envelopes.length === 1 && only !== undefined
    ? `add: ${only.title}`
    : `add: ${String(envelopes.length)} sources`;
}

/** One attempt: read the head, build the tree and commit on it, fast-forward. */
async function attemptCommit(
  config: WikiConfig,
  fetchImpl: typeof globalThis.fetch,
  envelopes: readonly Envelope[],
): Promise<CommitResult | 'moved'> {
  const refPath = '/git/ref/heads/main';
  const ref = await call<{ object?: { sha?: string } }>(config, fetchImpl, 'GET', refPath);
  const head = field(ref.object?.sha, 'GET', refPath, 'object.sha');
  const commitPath = `/git/commits/${head}`;
  const commit = await call<{ tree?: { sha?: string } }>(config, fetchImpl, 'GET', commitPath);
  const baseTree = field(commit.tree?.sha, 'GET', commitPath, 'tree.sha');
  const folders = nameFolders(envelopes, await takenInboxNames(config, fetchImpl, baseTree));

  const tree = envelopes.flatMap((envelope, index) =>
    envelope.files.map((file) => ({
      path: `${INBOX}/${folders[index] ?? ''}/${file.name}`,
      mode: '100644',
      type: 'blob',
      content: file.content,
    })),
  );
  const created = await call<{ sha?: string }>(config, fetchImpl, 'POST', '/git/trees', {
    base_tree: baseTree,
    tree,
  });
  const createdSha = field(created.sha, 'POST', '/git/trees', 'sha');
  const commitsPath = '/git/commits';
  const newCommit = await call<{ sha?: string }>(config, fetchImpl, 'POST', commitsPath, {
    message: commitMessage(envelopes),
    tree: createdSha,
    parents: [head],
  });
  const newCommitSha = field(newCommit.sha, 'POST', commitsPath, 'sha');

  const update = await send(config, fetchImpl, 'PATCH', '/git/refs/heads/main', {
    sha: newCommitSha,
    force: false,
  });
  // A 422 here means main is no longer at `head` — someone pushed in between. Any other refusal
  // is final: a 422 from the tree or commit POST above (a malformed path) is never "busy".
  if (update.status === 422) return 'moved';
  if (!update.ok) throw failure('PATCH', '/git/refs/heads/main', update);

  return { commitSha: newCommitSha, folders: folders.map((name) => `${INBOX}/${name}`) };
}

/**
 * Commit every envelope to the wiki's `main` in one commit, each in a brand-new `inbox/` folder.
 * Retries from the top when `main` moved during the attempt, up to {@link MAX_COMMIT_ATTEMPTS}
 * times in total, then fails as `busy`. Throws a {@link WikiWriteError} for every failure.
 */
export async function commitEnvelopes(
  config: WikiConfig,
  envelopes: readonly Envelope[],
  { fetch: fetchImpl = globalThis.fetch }: CommitOptions = {},
): Promise<CommitResult> {
  if (envelopes.length === 0) {
    throw new WikiWriteError('rejected', 'wiki: nothing to commit');
  }
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
    const result = await attemptCommit(config, fetchImpl, envelopes);
    if (result !== 'moved') return result;
  }
  throw new WikiWriteError(
    'busy',
    `wiki: main moved on every one of ${String(MAX_COMMIT_ATTEMPTS)} attempts`,
  );
}
