import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Helpers the hook's tests share: scratch dirs and small real git repos. */

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `hook-${prefix}-`));
}

/**
 * Drop the git variables a husky hook exports (GIT_DIR and friends) so a test repo is never the
 * real one. The hook's own git calls inherit `process.env`, so this edits it in place.
 */
export function scrubGitEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) Reflect.deleteProperty(process.env, key);
  }
}

export interface TempRepo {
  dir: string;
  /** The sha of the last commit. */
  head: string;
}

/** The environment a hook process should run in: no git or proxy variables, nothing alfred's. */
export function hookEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(GIT_|ALFRED_|LEDGER_|CLAUDE_|NODE_USE_ENV_PROXY)/.test(key)) {
      continue;
    }
    if (/^(https?|no|all)_proxy$/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * A repo with one commit per entry of `commits` (each a map of path to content), the last being
 * HEAD, and optionally an `origin` remote (never contacted).
 */
export function makeRepo(
  commits: readonly Record<string, string>[],
  remote: string | null = null,
): TempRepo {
  const dir = tempDir('repo');
  const git = (args: readonly string[]): string => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: hookEnv({
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com',
      }),
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(['init', '--quiet', '--initial-branch=main']);
  if (remote !== null) git(['remote', 'add', 'origin', remote]);
  for (const [index, files] of commits.entries()) {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', `commit ${String(index)}`]);
  }
  return { dir, head: git(['rev-parse', 'HEAD']) };
}
