import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

// Each case spawns the real CLI (it loads secretlint), so give it room.
jest.setTimeout(60_000);

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));

// Assembled at runtime so this file stays clean under the very scan it tests.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const OTHER = ['Hm4', 'nB8s', 'Yc3dK'].join('');
const LEAKED_URI = `postgresql://postgres.abcdefghijklmnop:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;
const LEAKED_ENV = `PGPASSWORD=${PASSWORD}`;
const ZEROS = '0'.repeat(40);

let repo: string;

function write(relative: string, content: string): void {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function commit(message: string): string {
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', message);
  return git('rev-parse', 'HEAD');
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  both: string;
}

function cli(
  args: string[],
  options: { input?: string; env?: Record<string, string>; cwd?: string } = {},
): Run {
  // A hook exports GIT_DIR / GIT_INDEX_FILE, which would point the CLI at the wrong repo.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('GIT_') && entry[0] !== 'DEBUG',
    ),
  );
  const result = spawnSync('node', [CLI, ...args], {
    cwd: options.cwd ?? repo,
    encoding: 'utf8',
    input: options.input ?? '',
    env: { ...env, ...options.env },
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    both: `${result.stdout}\n${result.stderr}`,
  };
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'secret-scan-cli-'));
  git('init', '--quiet', '-b', 'main');
  // CI runners have no global git identity, and `git merge` wants one even with --no-commit.
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('exit codes', () => {
  it('exits 0 on a clean tree', () => {
    write('a.md', 'hello\n');
    const run = cli([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('clean (1 text entries scanned)');
  });

  it('exits 1 with the remedy when a file carries a secret', () => {
    write('a.md', `${LEAKED_URI}\n`);
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('PostgreSQL connection string');
    expect(run.stderr).toContain('This repo is PUBLIC');
  });

  it.each([
    ['an unknown option', ['--nope']],
    ['--range without a range', ['--range']],
    ['an unexpected extra argument', ['--range', 'A..B', 'extra']],
    ['--branch with an argument', ['--branch', 'x']],
    ['--push without a remote', ['--push']],
  ])('exits 2 on %s', (_case, args) => {
    const run = cli(args);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('secret-scan --help');
  });

  it('prints usage and exits 0 for --help', () => {
    const run = cli(['--help']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('--push');
  });

  it('exits 1 and prints only the error message when git fails', () => {
    write('a.md', `${LEAKED_URI}\n`);
    commit('base');
    const run = cli(['--range', 'nosuchref..HEAD']);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/^secret-scan: error: .*git log/);
    expect(run.both).not.toContain('Buffer');
    expect(run.both).not.toContain(PASSWORD);
  });
});

describe('masking', () => {
  it('masks the secret in a pattern-rule finding', () => {
    write('env.md', `${LEAKED_ENV}\n`);
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('secretlint-rule-pattern');
    expect(run.both).not.toContain(PASSWORD);
  });

  it('masks the secret in a preset-rule finding', () => {
    write('leak.md', `${LEAKED_URI}\n`);
    expect(cli([]).both).not.toContain(PASSWORD);
  });

  it.each(['@secretlint/*', '*', 'secretlint*,@secretlint/*'])(
    'cannot be made to print the raw content by DEBUG=%s',
    (debug) => {
      write('env.md', `${LEAKED_ENV}\n`);
      write('leak.md', `${LEAKED_URI}\n`);
      const run = cli([], { env: { DEBUG: debug } });
      expect(run.code).toBe(1);
      expect(run.both).not.toContain(PASSWORD);
      expect(run.both).not.toContain('executeOnContent');
    },
  );
});

describe('default mode', () => {
  it('scans the staged blob even when the working copy was scrubbed', () => {
    write('a.md', `${LEAKED_URI}\n`);
    git('add', 'a.md');
    write('a.md', 'scrubbed\n');
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('a.md (staged)');
  });

  it('is clean once the scrubbed file is re-staged', () => {
    write('a.md', `${LEAKED_URI}\n`);
    git('add', 'a.md');
    write('a.md', 'scrubbed\n');
    git('add', 'a.md');
    expect(cli([]).code).toBe(0);
  });
});

describe('--range', () => {
  it('catches a secret added and removed inside the range', () => {
    write('a.md', 'base\n');
    commit('base');
    write('a.md', `${LEAKED_URI}\n`);
    commit('leak');
    write('a.md', 'scrubbed\n');
    commit('scrub');
    expect(cli([]).code).toBe(0);
    const run = cli(['--range', 'HEAD~2..HEAD']);
    expect(run.code).toBe(1);
    expect(run.both).not.toContain(PASSWORD);
  });
});

describe('--branch', () => {
  it('fails closed when there is no origin/main to measure from', () => {
    write('a.md', 'clean\n');
    commit('only');
    const run = cli(['--branch']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('origin/main');
  });

  it('scans every commit since origin/main, including a secret scrubbed at the tip', () => {
    write('a.md', 'trunk\n');
    commit('trunk');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write('a.md', `${LEAKED_URI}\n`);
    commit('leak');
    write('a.md', 'scrubbed\n');
    commit('scrub');
    expect(cli([]).code).toBe(0);
    expect(cli(['--branch']).code).toBe(1);
  });

  it('is clean when the branch adds nothing secret', () => {
    write('a.md', 'trunk\n');
    commit('trunk');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write('b.md', 'fine\n');
    commit('feature');
    const run = cli(['--branch']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('clean (1 text entries scanned)');
  });

  it('still scans an orphan branch that shares no history with origin/main', () => {
    write('a.md', 'trunk\n');
    commit('trunk');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '--quiet', '--orphan', 'unrelated');
    git('rm', '--quiet', '-rf', '.');
    write('leak.md', `${LEAKED_URI}\n`);
    commit('orphan leak');
    write('leak.md', 'scrubbed\n');
    commit('orphan scrub');
    expect(cli(['--branch']).code).toBe(1);
  });
});

function pushLine(localSha: string, ref = 'refs/heads/topic', remoteSha = ZEROS): string {
  return `${ref} ${localSha} ${ref} ${remoteSha}\n`;
}

/** main is clean and checked out; `topic` (not HEAD) carries a secret that its tip scrubs. */
function leakyTopic(): { main: string; topic: string } {
  write('a.md', 'trunk\n');
  const main = commit('trunk');
  git('checkout', '--quiet', '-b', 'topic');
  write('a.md', `${LEAKED_URI}\n`);
  commit('leak');
  write('a.md', 'scrubbed\n');
  const topic = commit('scrub');
  git('checkout', '--quiet', 'main');
  return { main, topic };
}

describe('--push', () => {
  it('scans the pushed ref, not the checked-out branch', () => {
    const { topic } = leakyTopic();
    expect(cli(['--branch']).code).toBe(1 /* no origin/main: fails closed */);
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(cli(['--branch']).code).toBe(0); // HEAD is main, so the branch scan sees nothing
    const run = cli(['--push', 'origin'], { input: pushLine(topic) });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('a.md');
    expect(run.both).not.toContain(PASSWORD);
  });

  it('is clean when the pushed commits are already on the remote', () => {
    const { topic } = leakyTopic();
    git('update-ref', 'refs/remotes/origin/topic', topic);
    expect(cli(['--push', 'origin'], { input: pushLine(topic) }).code).toBe(0);
  });

  it('only counts the named remote as having the commits', () => {
    const { topic } = leakyTopic();
    git('update-ref', 'refs/remotes/upstream/topic', topic);
    expect(cli(['--push', 'origin'], { input: pushLine(topic) }).code).toBe(1);
    expect(cli(['--push', 'upstream'], { input: pushLine(topic) }).code).toBe(0);
  });

  it('scans a ref that is pushed to a new name', () => {
    const { topic } = leakyTopic();
    const run = cli(['--push', 'origin'], {
      input: `refs/heads/topic ${topic} refs/heads/renamed ${ZEROS}\n`,
    });
    expect(run.code).toBe(1);
  });

  it('skips a deletion and empty input', () => {
    leakyTopic();
    const deletion = `(delete) ${ZEROS} refs/heads/topic ${'a'.repeat(40)}\n`;
    const run = cli(['--push', 'origin'], { input: deletion });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('clean (0 text entries scanned)');
    expect(cli(['--push', 'origin'], { input: '' }).code).toBe(0);
  });

  it('scans every pushed ref in one run', () => {
    const { main, topic } = leakyTopic();
    const run = cli(['--push', 'origin'], {
      input: pushLine(main, 'refs/heads/main') + pushLine(topic),
    });
    expect(run.code).toBe(1);
  });

  it('exits 1 on a malformed stdin line', () => {
    const run = cli(['--push', 'origin'], { input: 'garbage\n' });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('pre-push');
  });
});

describe('known live secret values', () => {
  // Bare values no pattern rule knows: `printenv PGPASSWORD`, a URI cut before `@host`, …
  const LIVE = { PGPASSWORD: PASSWORD };

  it('exits 1 on a committable file holding a live value, naming its source but not the value', () => {
    write('notes.md', `the output was\n${PASSWORD}\n`);
    const run = cli([], { env: LIVE });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('notes.md');
    expect(run.stdout).toContain('contains the value of $PGPASSWORD');
    expect(run.stderr).toContain('This repo is PUBLIC');
    expect(run.both).not.toContain(PASSWORD);
  });

  it('is a no-op when no live value is set', () => {
    write('notes.md', `the output was\n${PASSWORD}\n`);
    expect(cli([]).code).toBe(0);
  });

  it('is clean when the live value appears nowhere', () => {
    write('notes.md', 'nothing secret\n');
    const run = cli([], { env: LIVE });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('clean (1 text entries scanned)');
  });

  it('ignores a trivial live value', () => {
    write('notes.md', 'postgres\n');
    expect(cli([], { env: { PGPASSWORD: 'postgres' } }).code).toBe(0);
  });

  it('finds the URL-encoded and base64 forms', () => {
    write('a.md', `${encodeURIComponent(PASSWORD)}\n`);
    write('b.md', `${Buffer.from(PASSWORD).toString('base64')}\n`);
    const run = cli([], { env: LIVE });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('a.md');
    expect(run.stdout).toContain('b.md');
  });

  it('finds a value in a UTF-16 file with a BOM', () => {
    write('utf16.txt', '');
    writeFileSync(
      path.join(repo, 'utf16.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${PASSWORD}\n`, 'utf16le')]),
    );
    expect(cli([], { env: LIVE }).code).toBe(1);
  });

  it('finds a value in UTF-16 text without a BOM', () => {
    writeFileSync(path.join(repo, 'utf16.txt'), Buffer.from(`${PASSWORD}\n`, 'utf16le'));
    expect(cli([], { env: LIVE }).code).toBe(1);
  });

  it('finds a value that is only in the staged content', () => {
    write('a.md', `${PASSWORD}\n`);
    git('add', 'a.md');
    write('a.md', 'scrubbed\n');
    const run = cli([], { env: LIVE });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('a.md (staged)');
  });

  it('reads the password from a gitignored frontend/.env.local without scanning that file', () => {
    write('.gitignore', 'frontend/.env.local\n');
    write(
      'frontend/.env.local',
      `DATABASE_URL=postgresql://u:${PASSWORD}@host.example.com:5432/postgres\n`,
    );
    expect(cli([]).code).toBe(0);
    write('notes.md', `psql failed for ${PASSWORD}\n`);
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('contains the password from DATABASE_URL in frontend/.env.local');
    expect(run.both).not.toContain(PASSWORD);
  });

  it('reads every gitignored dotenv file, naming the one a value came from', () => {
    write('.gitignore', '.env*\n.dev.vars*\n!*.example\n');
    write('workers/.dev.vars', `GMAIL_ALFRED_REFRESH_TOKEN=${PASSWORD}\n`);
    write('workers/.dev.vars.example', 'GMAIL_ALFRED_REFRESH_TOKEN=<token>\n');
    write('database/.env', `MIGRATE_SECRET=${OTHER}\n`);
    expect(cli([]).code).toBe(0);
    write('a.md', `${PASSWORD}\n`);
    write('b.md', `${OTHER}\n`);
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain(
      'contains the value of GMAIL_ALFRED_REFRESH_TOKEN in workers/.dev.vars',
    );
    expect(run.stdout).toContain('contains the value of MIGRATE_SECRET in database/.env');
    expect(run.both).not.toContain(PASSWORD);
    expect(run.both).not.toContain(OTHER);
  });

  it('fails closed, naming the file and errno only, when a dotenv file cannot be read', () => {
    write('.gitignore', '.env*\n');
    // A symlink to a directory is listed by git as a file but cannot be read as one.
    symlinkSync(repo, path.join(repo, '.env.local'));
    const run = cli([]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('secret-scan: error: cannot read .env.local: EISDIR');
    expect(run.both).not.toContain(repo);
  });

  describe('from a linked git worktree', () => {
    let worktree: string;

    beforeEach(() => {
      write('.gitignore', '.env*\n.dev.vars*\n');
      write('a.md', 'base\n');
      commit('base');
      // The gitignored env files exist only in the main checkout.
      write('frontend/.env.local', `MY_API_SECRET=${PASSWORD}\n`);
      worktree = `${repo}-worktree`;
      git('worktree', 'add', '--quiet', worktree, '-b', 'feature');
    });

    afterEach(() => {
      rmSync(worktree, { recursive: true, force: true });
    });

    it('still refuses a live value that only the main checkout env file holds', () => {
      writeFileSync(path.join(worktree, 'notes.md'), `leaked ${PASSWORD}\n`);
      const run = cli([], { cwd: worktree });
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('contains the value of MY_API_SECRET in frontend/.env.local');
      expect(run.both).not.toContain(PASSWORD);
    });

    it('is clean when the worktree holds no live value', () => {
      writeFileSync(path.join(worktree, 'notes.md'), 'fine\n');
      expect(cli([], { cwd: worktree }).code).toBe(0);
    });

    it('also reads the worktree own env files', () => {
      writeFileSync(path.join(worktree, '.dev.vars'), `GMAIL_X_TOKEN=${OTHER}\n`);
      writeFileSync(path.join(worktree, 'notes.md'), `leaked ${OTHER}\n`);
      const run = cli([], { cwd: worktree });
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('contains the value of GMAIL_X_TOKEN in .dev.vars');
    });
  });

  it('applies to --range too', () => {
    write('a.md', 'base\n');
    commit('base');
    write('a.md', `${PASSWORD}\n`);
    commit('leak');
    write('a.md', 'scrubbed\n');
    commit('scrub');
    expect(cli(['--range', 'HEAD~2..HEAD']).code).toBe(0);
    const run = cli(['--range', 'HEAD~2..HEAD'], { env: LIVE });
    expect(run.code).toBe(1);
    expect(run.both).not.toContain(PASSWORD);
  });
});
