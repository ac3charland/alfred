import { BUILDER_PATH } from '../git.ts';
import type { GitRunner } from '../git.ts';

/** `owner/name` out of a remote URL: https, scp-style ssh, or the cloud's local git proxy. */
export function normalizeRepo(remote: string): string | null {
  const segments = remote
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    // Drop `scheme://host[:port]/` or scp-style `user@host:`, leaving the path.
    .replace(/^[a-z][\w+.-]*:\/\/[^/]*\//i, '')
    .replace(/^[^/:]+@[^/:]+:/, '')
    .split('/');
  const repo = segments.slice(-2).join('/');
  return segments.length >= 2 && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

function output(git: GitRunner, args: readonly string[]): string | null {
  const result = git(args);
  const text = result.stdout.trim();
  return result.status === 0 && text !== '' ? text : null;
}

/** The repo as `origin` names it, or null without an origin. */
export function repoFromRemote(git: GitRunner): string | null {
  const remote = output(git, ['remote', 'get-url', 'origin']);
  return remote === null ? null : normalizeRepo(remote);
}

/**
 * The commit the session starts on, the last commit that changed the launch-prompt builders (null
 * when a shallow clone doesn't reach it; nothing here deepens the clone) and the repo.
 */
export function captureStart(git: GitRunner): {
  repo: string | null;
  base_sha: string | null;
  builder_sha: string | null;
} {
  return {
    repo: repoFromRemote(git),
    base_sha: output(git, ['rev-parse', 'HEAD']),
    builder_sha: output(git, ['log', '-1', '--format=%H', 'HEAD', '--', BUILDER_PATH]),
  };
}
