/**
 * The wiki writer's configuration, read from environment.
 *
 * Alfred writes into the knowledge wiki's repo through GitHub's Git Data API with a fine-grained
 * PAT scoped to that one repo. The token is set on the Personal deployment only; the Work
 * instance runs the identical code with no token, so `getWikiConfig()` answers `undefined` there
 * and every send affordance disappears (the layout seeds `writable: false`). The token is
 * server-only: it is never `NEXT_PUBLIC_`, never seeded to the client, and never echoed in an
 * error or a log line. Each var is read by its literal name, mirroring `lib/instance.ts`.
 */
import 'server-only';

import type { WikiClientConfig } from '@/lib/types';

/** GitHub's REST origin. Overridden only by the Playwright harness, to its mock server. */
export const DEFAULT_WIKI_API_URL = 'https://api.github.com';

export interface WikiConfig {
  /** The repo owner, e.g. `ac3charland`. */
  owner: string;
  /** The repo name, e.g. `knowledge`. */
  name: string;
  /** The fine-grained PAT with Contents: read and write on that one repo. */
  token: string;
  /** The API origin every request is built on, with no trailing slash. */
  apiUrl: string;
}

/** `owner/name` — one path segment each, no slashes inside, surrounding whitespace tolerated. */
const REPO_ENTRY = /^\s*([\w.-]+)\/([\w.-]+)\s*$/;

/** Trim and collapse a blank env value to `undefined`, so `??` defaults treat "" as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') {
    return undefined;
  }
  return trimmed;
}

/** `.` and `..` match `[\w.-]+` but name no real GitHub owner or repo — path segments, not names. */
function isPathSegment(value: string): boolean {
  return value === '.' || value === '..';
}

/** The `owner/name` pair `WIKI_REPO` names, or `undefined` when it is unset or malformed. */
function parseRepo(raw: string | undefined): { owner: string; name: string } | undefined {
  const match = REPO_ENTRY.exec(raw ?? '');
  if (!match) return undefined;
  const [, owner, name] = match;
  if (owner === undefined || name === undefined) return undefined;
  if (isPathSegment(owner) || isPathSegment(name)) return undefined;
  return { owner, name };
}

/**
 * The full writer config, or `undefined` unless BOTH the token and a parseable repo are set.
 * Half a configuration is treated as none: a token with no repo has nowhere to write, and a repo
 * with no token cannot write, so either way the writer is off and the routes answer 501.
 */
export function getWikiConfig(): WikiConfig | undefined {
  const token = envValue(process.env.WIKI_GITHUB_TOKEN);
  const repo = parseRepo(envValue(process.env.WIKI_REPO));
  if (token === undefined || repo === undefined) return undefined;
  const apiUrl = (envValue(process.env.WIKI_GITHUB_API_URL) ?? DEFAULT_WIKI_API_URL).replace(
    /\/+$/,
    '',
  );
  return { owner: repo.owner, name: repo.name, token, apiUrl };
}

/**
 * What the shell seeds the client with: the repo name for GitHub links and whether this
 * deployment can write. The token never rides along — this is the whole client-visible surface.
 */
export function getWikiClientConfig(): WikiClientConfig {
  return { repo: getWikiRepoName(), writable: getWikiConfig() !== undefined };
}

/**
 * The `owner/name` the client builds GitHub links from, or `null` when `WIKI_REPO` is unset or
 * malformed. Independent of the token: a deployment can know where the wiki lives (and link raw
 * citations to it) without being able to write into it.
 */
export function getWikiRepoName(): string | null {
  const repo = parseRepo(envValue(process.env.WIKI_REPO));
  return repo === undefined ? null : `${repo.owner}/${repo.name}`;
}
