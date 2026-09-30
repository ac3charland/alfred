import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  MIGRATIONS_DIR,
  envLocalCandidates,
  migrationFiles,
  parseEnvValue,
  resolveDatabaseUrl,
  sorted,
} from './migrate.ts';

describe('sorted', () => {
  it('orders lexicographically and returns a copy', () => {
    const input = ['0010_b.sql', '0002_a.sql', '0001_z.sql'];
    expect(sorted(input)).toStrictEqual(['0001_z.sql', '0002_a.sql', '0010_b.sql']);
    expect(input[0]).toBe('0010_b.sql'); // original left untouched
  });
});

describe('migrationFiles', () => {
  it('returns only .sql files in filename order, ignoring other files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alfred-mig-'));
    try {
      writeFileSync(path.join(dir, '0002_b.sql'), '');
      writeFileSync(path.join(dir, '0001_a.sql'), '');
      writeFileSync(path.join(dir, 'README.md'), '');
      expect(migrationFiles(dir).map((file) => path.basename(file))).toStrictEqual([
        '0001_a.sql',
        '0002_b.sql',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves the real migrations dir, starting at the initial schema in apply order', () => {
    const files = migrationFiles(MIGRATIONS_DIR).map((file) => path.basename(file));
    expect(files[0]).toBe('0001_initial_schema.sql');
    expect(files).toContain('0008_grant_priority_seq.sql');
    // Filename order IS apply order — the list must already be sorted.
    expect(files).toStrictEqual(sorted(files));
  });
});

describe('parseEnvValue', () => {
  it('reads a quoted value and ignores comments and other keys', () => {
    const body = ['# a comment', 'OTHER=nope', 'DATABASE_URL="postgres://u@h:5432/db"', ''].join(
      '\n',
    );
    expect(parseEnvValue(body, 'DATABASE_URL')).toBe('postgres://u@h:5432/db');
  });

  it('tolerates a leading export and unquoted values', () => {
    expect(parseEnvValue('export DATABASE_URL=postgres://x', 'DATABASE_URL')).toBe('postgres://x');
  });

  it('returns undefined for a missing key', () => {
    expect(parseEnvValue('FOO=bar', 'DATABASE_URL')).toBeUndefined();
  });
});

describe('parseEnvValue precedence', () => {
  it('takes the LAST assignment of a duplicated key, as dotenv and Next.js do', () => {
    const body = ['DATABASE_URL=postgres://first', 'OTHER=1', 'DATABASE_URL=postgres://last'].join(
      '\n',
    );
    expect(parseEnvValue(body, 'DATABASE_URL')).toBe('postgres://last');
  });
});

function writeEnv(root: string, body: string): void {
  mkdirSync(path.join(root, 'frontend'), { recursive: true });
  writeFileSync(path.join(root, 'frontend', '.env.local'), body);
}

/** git with the hook-exported repo-location vars stripped, so it targets `cwd`, not the outer repo. */
function git(cwd: string, ...args: string[]): string {
  const { GIT_DIR: _d, GIT_INDEX_FILE: _i, GIT_WORK_TREE: _w, ...env } = process.env;
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

describe('resolveDatabaseUrl env-file fallback', () => {
  // A name nothing exports, so resolution falls through to the file(s).
  const UNSET = ['ALFRED_TEST', 'UNSET_URL'].join('_');
  // Assembled at runtime so this file stays clean under the repo's own secret scan.
  const URL_A = ['postgresql://u:', 'Qz7vLk2', 'Rw9pT', '@main.example:5432/db'].join('');
  let tmp: string;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'alfred-env-')));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function mainAndWorktree(): { main: string; worktree: string } {
    const main = path.join(tmp, 'main');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = path.join(tmp, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'wt', worktree);
    return { main, worktree };
  }

  it('lists the checkout own file, then the main checkout file, when run from a linked worktree', () => {
    const { main, worktree } = mainAndWorktree();
    expect(envLocalCandidates(worktree)).toStrictEqual([
      path.join(worktree, 'frontend', '.env.local'),
      path.join(main, 'frontend', '.env.local'),
    ]);
  });

  it('lists only its own file in a plain checkout', () => {
    const { main } = mainAndWorktree();
    expect(envLocalCandidates(main)).toStrictEqual([path.join(main, 'frontend', '.env.local')]);
  });

  it('lists only its own file when git cannot tell (not a repository)', () => {
    const plain = path.join(tmp, 'plain');
    mkdirSync(plain);
    expect(envLocalCandidates(plain)).toStrictEqual([path.join(plain, 'frontend', '.env.local')]);
  });

  it('resolves from the worktree own file first', () => {
    const { main, worktree } = mainAndWorktree();
    writeEnv(main, `DATABASE_URL=${URL_A}\n`);
    writeEnv(worktree, 'DATABASE_URL=postgresql://own@wt.example/db\n');
    expect(resolveDatabaseUrl([UNSET], envLocalCandidates(worktree))).toBe(
      'postgresql://own@wt.example/db',
    );
  });

  it('falls back to the main checkout file from a linked worktree that has none', () => {
    const { main, worktree } = mainAndWorktree();
    writeEnv(main, `DATABASE_URL=${URL_A}\n`);
    expect(resolveDatabaseUrl([UNSET], envLocalCandidates(worktree))).toBe(URL_A);
  });

  it('names every path it tried, and no value, when none has a URL', () => {
    const { main, worktree } = mainAndWorktree();
    writeEnv(main, `OTHER=${URL_A}\n`);
    let message = '';
    try {
      resolveDatabaseUrl([UNSET], envLocalCandidates(worktree));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(path.join(worktree, 'frontend', '.env.local'));
    expect(message).toContain(path.join(main, 'frontend', '.env.local'));
    expect(message).not.toContain('Qz7vLk2');
  });
});
