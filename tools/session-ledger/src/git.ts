import { spawnSync } from 'node:child_process';

/**
 * Git history: every anchor a ledger row is resolved against. Rows are resolved at `base_sha`,
 * the last first-parent main commit at or before the session started, because a session
 * launched from alfred's link clones main as it starts and Vercel deploys main.
 */

/** Runs one git command; `status` is the exit code. Injected so tests can drive a fixture repo. */
export type GitRunner = (args: readonly string[]) => { status: number; stdout: string };

/** A runner over the repo at `cwd`. */
export function gitIn(cwd: string): GitRunner {
  return (args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return { status: result.status ?? 1, stdout: result.stdout };
  };
}

/** The launch-prompt builders' file — the prompt at any commit is whatever this file built. */
export const BUILDER_PATH = 'frontend/lib/code/links.ts';

/** Claude's commits are always authored with this address; every other author is a human. */
export const CLAUDE_EMAIL = 'noreply@anthropic.com';

interface MainCommit {
  sha: string;
  committedAt: number;
}

export class GitHistory {
  readonly #git: GitRunner;
  readonly #mainRef: string;
  #mainLine: MainCommit[] | undefined;
  readonly #builders = new Map<string, { sha: string | null; landedAt: number | null }>();

  constructor(git: GitRunner, mainRef = 'origin/main') {
    this.#git = git;
    this.#mainRef = mainRef;
  }

  /** Trimmed stdout, or null when the command failed or printed nothing. */
  #run(args: readonly string[]): string | null {
    const result = this.#git(args);
    const out = result.stdout.trim();
    return result.status === 0 && out !== '' ? out : null;
  }

  /** Whether the clone is shallow — ancestry and history questions are wrong on one. */
  isShallow(): boolean {
    return this.#run(['rev-parse', '--is-shallow-repository']) === 'true';
  }

  /** Main's first-parent line, newest first, read once. */
  #main(): MainCommit[] {
    this.#mainLine ??= (
      this.#run(['log', '--first-parent', '--format=%H %ct', this.#mainRef]) ?? ''
    )
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [sha = '', seconds = '0'] = line.split(' ');
        return { sha, committedAt: Number(seconds) };
      });
    return this.#mainLine;
  }

  /** The last first-parent main commit whose committer date is at or before `at`. */
  baseShaAt(at: Date): string | null {
    const seconds = Math.floor(at.getTime() / 1000);
    return this.#main().find((commit) => commit.committedAt <= seconds)?.sha ?? null;
  }

  #builder(base: string): { sha: string | null; landedAt: number | null } {
    let found = this.#builders.get(base);
    if (found === undefined) {
      const sha = this.#run(['log', '-1', '--format=%H', base, '--', BUILDER_PATH]);
      // When the change reached main: the first-parent commit that brought it (a merge commit
      // for a PR), not the branch commit's own date.
      const landed = this.#run([
        'log',
        '--first-parent',
        '-1',
        '--format=%ct',
        base,
        '--',
        BUILDER_PATH,
      ]);
      found = { sha, landedAt: landed === null ? null : Number(landed) };
      this.#builders.set(base, found);
    }
    return found;
  }

  /** The last commit that changed the builder file, as of `base`. */
  builderSha(base: string): string | null {
    return this.#builder(base).sha;
  }

  /** When that change landed on main (unix seconds), or null when the file never existed. */
  builderLandedAt(base: string): number | null {
    return this.#builder(base).landedAt;
  }

  /** The blob sha of `path` at `commit`, or null when the file doesn't exist there. */
  blobAt(commit: string, path: string): string | null {
    return this.#run(['rev-parse', '--verify', '--quiet', `${commit}:${path}`]);
  }

  /** The contents of `path` at `commit`, or null when it doesn't exist there. */
  showFile(commit: string, path: string): string | null {
    const result = this.#git(['show', `${commit}:${path}`]);
    return result.status === 0 ? result.stdout : null;
  }

  hasCommit(sha: string): boolean {
    return this.#git(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
  }

  /**
   * Make a PR's head commit available locally: a merged PR's head is usually already in main's
   * history, an open or closed one only under GitHub's `refs/pull/<n>/head`. True when present.
   */
  ensureHead(prNumber: number, sha: string): boolean {
    if (this.hasCommit(sha)) return true;
    this.#git(['fetch', '--quiet', 'origin', `refs/pull/${String(prNumber)}/head`]);
    return this.hasCommit(sha);
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return this.#git(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
  }

  /**
   * Commits on the branch's own first-parent line from `base` to `head` — no merges, so neither
   * the main commits a branch merged in later nor the merge itself count — authored after
   * `openedAt` by anyone but Claude.
   */
  humanCommitsAfter(base: string, head: string, openedAt: Date): number {
    const log = this.#run([
      'log',
      '--first-parent',
      '--no-merges',
      '--format=%ae %at',
      `${base}..${head}`,
    ]);
    const opened = openedAt.getTime() / 1000;
    return (log ?? '')
      .split('\n')
      .filter((line) => line !== '')
      .filter((line) => {
        const [email = '', seconds = '0'] = line.split(' ');
        return email !== CLAUDE_EMAIL && Number(seconds) > opened;
      }).length;
  }
}
