/**
 * The snapshot's two GitHub reads, both POSTs to the GraphQL endpoint.
 *
 * #1 reads the tip of `main` and the four section folders' entries — every page's blob oid — in
 * one query. #2 reads the text of the changed blobs, one alias per blob, also in one query. The
 * REST Contents API would spend a subrequest per file (see `fetchSpec` in `../github.ts`); this
 * spends two whatever the size of the change.
 *
 * Both are strict about failure. GraphQL answers a partial or rate-limited query with `200` and
 * an `errors` array beside whatever data it did resolve, and a missing section reads as a null
 * object — so a lenient reader would see an empty tree and the sync would delete every page.
 * Any `errors` entry, a null repository or ref, or a non-2xx is therefore a throw, never an empty
 * answer; a null section counts as empty only in a response that carries no errors at all.
 */
import { WIKI_SECTIONS } from './page';

/** A `fetch` the sync can be handed, so a test can count and route its subrequests. */
export type WikiFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface WikiGithubEnv {
  GITHUB_TOKEN: string;
  /** `owner/name`. */
  WIKI_REPO: string;
}

const GRAPHQL_URL = 'https://api.github.com/graphql';

/** A git object id: 40 hex characters (SHA-1), or 64 for a SHA-256 repository. */
const OID = /^(?:[\da-f]{40}|[\da-f]{64})$/;

/** A GitHub owner or repository name — the only characters either may contain. */
const REPO_PART = /^[\w.-]+$/;

/** One page in the tree: its repo path and the blob oid the diff compares. */
export interface WikiTreeEntry {
  path: string;
  oid: string;
}

export interface WikiTree {
  /** The commit `main` pointed at when the tree was read. */
  commitOid: string;
  entries: WikiTreeEntry[];
}

/** One blob as GitHub hands it over. `text` is absent for a binary blob. */
export interface WikiBlob {
  text: string | undefined;
  isBinary: boolean;
  isTruncated: boolean;
}

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: { message?: string }[];
}

interface WireEntry {
  name: string;
  type: string;
  oid: string;
}

interface WireTree {
  entries?: WireEntry[] | null;
}

type WireRepositoryTree = Record<string, unknown> & {
  ref?: { target?: { oid?: string } | null } | null;
};

interface WireBlob {
  text: string | null;
  isBinary: boolean | null;
  isTruncated: boolean;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name, extra] = repo.split('/');
  if (
    owner === undefined ||
    name === undefined ||
    extra !== undefined ||
    !REPO_PART.test(owner) ||
    !REPO_PART.test(name)
  ) {
    throw new Error(`WIKI_REPO is not owner/name: ${repo}`);
  }
  return { owner, name };
}

/**
 * POST one query and return its `data`, or throw. A response with ANY `errors` entry throws even
 * when `data` came back beside it: partial data is exactly the answer that must not be trusted.
 */
async function query<T>(
  env: WikiGithubEnv,
  doFetch: WikiFetch,
  body: { query: string; variables: Record<string, string> },
  context: string,
): Promise<T> {
  const response = await doFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub rejects API requests with no User-Agent.
      'User-Agent': 'alfred-software-factory',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub GraphQL ${context} failed: ${String(response.status)} ${detail}`);
  }

  const payload = await response.json<GraphqlResponse<T>>();
  if (payload.errors !== undefined && payload.errors.length > 0) {
    const messages = payload.errors.map((error) => error.message ?? 'unknown error').join('; ');
    throw new Error(`GitHub GraphQL ${context} returned errors: ${messages}`);
  }
  if (payload.data == undefined) throw new Error(`GitHub GraphQL ${context} returned no data`);
  return payload.data;
}

/** The query text for #1 — exported so a test can pin its shape. */
export const TREE_QUERY = [
  'query($owner: String!, $name: String!) {',
  '  repository(owner: $owner, name: $name) {',
  '    ref(qualifiedName: "refs/heads/main") { target { oid } }',
  ...WIKI_SECTIONS.map(
    (section) =>
      `    ${section}: object(expression: "main:wiki/${section}") { ... on Tree { entries { name type oid } } }`,
  ),
  '  }',
  '}',
].join('\n');

/**
 * GraphQL #1: the commit at the tip of `main` and every `wiki/<section>/*.md` blob under it.
 * Sub-folders and non-markdown files are not pages and are left out.
 */
export async function fetchWikiTree(env: WikiGithubEnv, doFetch: WikiFetch): Promise<WikiTree> {
  const data = await query<{ repository: WireRepositoryTree | null }>(
    env,
    doFetch,
    { query: TREE_QUERY, variables: splitRepo(env.WIKI_REPO) },
    'tree',
  );
  const repository = data.repository ?? undefined;
  if (repository === undefined)
    throw new Error(`GitHub GraphQL tree: no repository ${env.WIKI_REPO}`);
  const commitOid = repository.ref?.target?.oid;
  if (commitOid === undefined) throw new Error('GitHub GraphQL tree: no refs/heads/main');

  const entries: WikiTreeEntry[] = [];
  for (const section of WIKI_SECTIONS) {
    // The alias must be there: a response that simply lacks it answered some other question,
    // and reading that as an empty section would delete every page in it.
    if (!(section in repository)) throw new Error(`GitHub GraphQL tree: no ${section} section`);
    // Null only when the folder does not exist yet — and this response carried no errors, so
    // that is the truth rather than a failure dressed as one.
    const tree = (repository[section] ?? undefined) as WireTree | undefined;
    for (const entry of tree?.entries ?? []) {
      // A bare `.md` has no stem, so `wiki/<section>/.md` is no page path: `sectionOf`'s
      // `[^/]+\.md` would throw on it and fail the whole run.
      if (entry.type === 'blob' && entry.name.endsWith('.md') && entry.name !== '.md') {
        entries.push({ path: `wiki/${section}/${entry.name}`, oid: entry.oid });
      }
    }
  }
  return { commitOid, entries };
}

/** The query text for #2 over `oids`, one `p<i>` alias each, in order. */
export function blobsQuery(oids: string[]): string {
  const aliases = oids.map((oid, index) => {
    // Inlined rather than passed as variables, so validated: an oid is hex and nothing else.
    if (!OID.test(oid)) throw new Error(`not a git object id: ${oid}`);
    return `    p${String(index)}: object(oid: "${oid}") { ... on Blob { text isBinary isTruncated } }`;
  });
  return [
    'query($owner: String!, $name: String!) {',
    '  repository(owner: $owner, name: $name) {',
    ...aliases,
    '  }',
    '}',
  ].join('\n');
}

/**
 * GraphQL #2: the text of each blob in `oids`, returned in the same order. Fetching by oid, not
 * by path, means the text is exactly the blob the diff chose — a push landing between the two
 * queries cannot swap it. An oid GitHub cannot find is a failure, not a page.
 */
export async function fetchWikiBlobs(
  env: WikiGithubEnv,
  doFetch: WikiFetch,
  oids: string[],
): Promise<WikiBlob[]> {
  const data = await query<{ repository: Record<string, WireBlob | null> | null }>(
    env,
    doFetch,
    { query: blobsQuery(oids), variables: splitRepo(env.WIKI_REPO) },
    'blobs',
  );
  const repository = data.repository ?? undefined;
  if (repository === undefined)
    throw new Error(`GitHub GraphQL blobs: no repository ${env.WIKI_REPO}`);

  return oids.map((oid, index) => {
    const blob = repository[`p${String(index)}`] ?? undefined;
    if (blob === undefined) throw new Error(`GitHub GraphQL blobs: no blob ${oid}`);
    return {
      text: blob.text ?? undefined,
      isBinary: blob.isBinary === true,
      isTruncated: blob.isTruncated,
    };
  });
}
