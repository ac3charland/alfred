import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  branchRange,
  committableFiles,
  decodeText,
  hasBinaryMagic,
  pushRevs,
  rangeEntries,
  scanEntries,
  scanFiles,
  stagedEntries,
} from './scan.ts';

// Every fixture secret is assembled at runtime from innocuous parts, so this file itself stays
// clean under the very scan it tests (the scanner reads source text, not evaluated values).
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const PG_SUPERUSER = 'postgres';
const LEAKED_URI = `postgresql://postgres.abcdefghijklmnop:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;
const SUPABASE_SECRET_KEY = ['sb', 'secret', 'Xk29fLq8Zr4Tn6Vp1Wy3Bc5D'].join('_');
const SUPABASE_ACCESS_TOKEN = ['sbp', 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'].join('_');
const SUPABASE_ACCESS_TOKEN_V0 = ['sbp', 'v0', 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'].join(
  '_',
);
const POOLER_HOST = 'aws-1-us-east-2.pooler.supabase.com';

let repo: string;

function write(relative: string, content: string | Buffer): void {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function gitOut(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function commit(message: string): void {
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', message);
}

// Real magic-byte prefixes of the formats the repo tracks (PNG, GIF) and other common binaries.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Buffer.from('GIF89a');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP')]);
const PDF = Buffer.from('%PDF-1.7');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP = Buffer.from([0x1f, 0x8b, 0x08]);

function failureOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

function utf16(text: string, order: 'le' | 'be'): Buffer {
  const le = Buffer.from(text, 'utf16le');
  if (order === 'le') return Buffer.concat([Buffer.from([0xff, 0xfe]), le]);
  return Buffer.concat([Buffer.from([0xfe, 0xff]), le.swap16()]);
}

async function scanOne(
  relative: string,
  content: string,
): Promise<{ ok: boolean; output: string }> {
  write(relative, content);
  return scanFiles(repo, [relative]);
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  git('init', '--quiet');
  // CI runners have no global git identity, and `git merge` wants one even with --no-commit.
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('scanFiles', () => {
  it('flags a Postgres connection string that carries a password', async () => {
    const result = await scanOne('demo.md', `psql '${LEAKED_URI}' -c 'select 1'\n`);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('demo.md');
    expect(result.output).toContain('PostgreSQL connection string');
  });

  it('masks the secret in its report, so the report is safe to print in a public CI log', async () => {
    const result = await scanOne('demo.md', `${LEAKED_URI}\n`);
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain(PASSWORD);
  });

  it('allows the documented `:<password>@` placeholder template', async () => {
    const template =
      'postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres';
    const result = await scanOne('SKILL.md', `${template}\n`);
    expect(result.ok).toBe(true);
  });

  it('passes the safe form that reads the URL from the environment', async () => {
    const result = await scanOne('demo.md', `psql "$DATABASE_URL" -c "select 1"\n`);
    expect(result.ok).toBe(true);
  });

  it('flags a Supabase secret API key but not the short mock/placeholder keys', async () => {
    const real = await scanOne('a.ts', `const key = '${SUPABASE_SECRET_KEY}';\n`);
    expect(real.ok).toBe(false);
    const placeholders = ['sb_secret_mock', 'sb_secret_placeholder', 'sb_secret_demo'];
    const result = await scanOne('b.ts', `${placeholders.join('\n')}\n`);
    expect(result.ok).toBe(true);
  });

  it('flags a Supabase personal access token', async () => {
    const result = await scanOne('env.md', `SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN}\n`);
    expect(result.ok).toBe(false);
  });

  it('cannot be silenced by a secretlint-disable comment', async () => {
    const directive = ['secretlint', 'disable'].join('-');
    const result = await scanOne('demo.md', `<!-- ${directive} -->\n${LEAKED_URI}\n`);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['a PGPASSWORD assignment', `PGPASSWORD=${PASSWORD} psql -h db.example.com -U postgres`],
    ['an exported PGPASSWORD', `export PGPASSWORD='${PASSWORD}'`],
    ['a libpq keyword conninfo', `psql "host=db.example.com user=postgres password=${PASSWORD}"`],
    [
      'a ?password= query param',
      `postgresql://postgres@db.example.com/postgres?password=${PASSWORD}`,
    ],
    [
      'a JWT (e.g. a legacy service_role key)',
      [
        'eyJhbGciOiJIUzI1NiJ9',
        'eyJyb2xlIjoic2VydmljZV9yb2xlIn0',
        'Qz7vLk2Rw9pTQz7vLk2Rw9pTQz7vLk2',
      ].join('.'),
    ],
  ])('flags %s', async (_shape, line) => {
    const result = await scanOne('demo.md', `${line}\n`);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['a quoted conninfo password', `psql "host=db.example.com password='${PASSWORD}'"`],
    ['a spaced conninfo password', `dsn: host=db.example.com password = '${PASSWORD}' user=x`],
    ['a double-quoted password', `conn = { password="${PASSWORD}" }`],
    ['a quoted conninfo password with spaces', `password = '${PASSWORD} two words'`],
    ['a PG_PASSWORD env assignment', `PG_PASSWORD=${PASSWORD}`],
    ['a POSTGRES_PASSWORD YAML value', `      POSTGRES_PASSWORD: ${PASSWORD}`],
    ['a quoted DB_PASSWORD', `DB_PASSWORD="${PASSWORD}"`],
    ['a SUPABASE_DB_PASSWORD export', `export SUPABASE_DB_PASSWORD='${PASSWORD}'`],
    ['a quoted JSON DB_PASSWORD', `{ "DB_PASSWORD": "${PASSWORD}" }`],
    ['a quoted DB_PASSWORD object property', `{ DB_PASSWORD: '${PASSWORD}' }`],
    // An unquoted value followed by `;`/`,`/`}` is still a password in a shell or YAML line; only
    // code (a member expression after `=`, a bare identifier after `:`) is exempt.
    ['a SUPABASE_DB_PASSWORD before a `;`', `SUPABASE_DB_PASSWORD=${PASSWORD}; supabase db dump`],
    ['a POSTGRES_PASSWORD before a `,`', `POSTGRES_PASSWORD=${PASSWORD}, next`],
    ['a DB_PASSWORD in a YAML flow map', `{DB_PASSWORD: ${PASSWORD}}`],
    ['a DATABASE_PASSWORD assignment', `DATABASE_PASSWORD = ${PASSWORD}`],
    [
      'a POSTGRES_PASSWORD that only starts with postgres',
      `POSTGRES_PASSWORD: ${PG_SUPERUSER}${PASSWORD}`,
    ],
    ['supabase --password <value>', `supabase db push --password ${PASSWORD} --linked`],
    ['supabase --password=<value>', `npx supabase link --project-ref abc --password=${PASSWORD}`],
    ['supabase -p <value>', `supabase db dump -p '${PASSWORD}'`],
    [
      'a shell PW variable used in a connection URL',
      `PW=${PASSWORD} psql "postgresql://postgres.ref:$PW@host:5432/postgres"`,
    ],
    ['a DB_PASS variable before a `;`', `DB_PASS=${PASSWORD}; psql -h db.example.com`],
    ['a PGPASS variable', `PGPASS=${PASSWORD} psql -h db.example.com`],
    ['a quoted SUPABASE_DB_PASS export', `export SUPABASE_DB_PASS='${PASSWORD}'`],
    ['a DB_PASSWD variable', `DB_PASSWD=${PASSWORD}`],
    ['a DB_PWD variable', `DB_PWD="${PASSWORD}"`],
    [
      'a lowercase alter role password',
      `alter role alfred_reader with login password '${PASSWORD}';`,
    ],
    ['an uppercase create role password', `CREATE ROLE x LOGIN PASSWORD '${PASSWORD}'`],
    ['an encrypted role password', `create role x encrypted password '${PASSWORD}'`],
    ['a .pgpass line', `${POOLER_HOST}:5432:postgres:postgres.abcdefghijklmnop:${PASSWORD}`],
    ['a .pgpass line with a wildcard port', `${POOLER_HOST}:*:postgres:postgres.ref:${PASSWORD}`],
    ['a .pgpass line after other lines', `# creds\n${POOLER_HOST}:5432:*:alfred:${PASSWORD}\n`],
    [
      'a versioned Supabase personal access token',
      `SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN_V0}`,
    ],
  ])('flags %s', async (_shape, line) => {
    const result = await scanOne('demo.md', `${line}\n`);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['PGPASSWORD from a variable', 'PGPASSWORD="$DB_PASSWORD" psql -h db.example.com'],
    ['a conninfo placeholder', 'psql "host=db.example.com user=postgres password=<password>"'],
    ['a masked conninfo', 'psql "host=db.example.com password=****"'],
    ['a quoted conninfo placeholder', `psql "host=db.example.com password='<password>'"`],
    ['a spaced masked conninfo', `password = '****'`],
    ['a quoted variable conninfo', `password = "$DB_PASSWORD"`],
    ['a template-literal conninfo', 'password = `${password}`'],
    ['a short quoted value', `password = 'abc'`],
    ['POSTGRES_PASSWORD set to the throwaway service value', '      POSTGRES_PASSWORD: postgres'],
    ['a quoted throwaway POSTGRES_PASSWORD', `POSTGRES_PASSWORD="postgres"`],
    ['a PGPASSWORD env entry that reads a variable', 'const env = { PGPASSWORD: password };'],
    [
      'a PGPASSWORD env entry that reads a constant',
      'expect(env).toEqual({ PGPASSWORD: PASSWORD });',
    ],
    ['a DB_PASSWORD read from process.env', 'const DB_PASSWORD = process.env.DB_PASSWORD;'],
    ['a DB_PASSWORD type annotation', 'interface Env { DB_PASSWORD: string; }'],
    ['DB_PASSWORD from a variable', 'DB_PASSWORD="$DB_PASSWORD"'],
    ['DB_PASSWORD from ${VAR}', 'DB_PASSWORD=${DB_PASSWORD}'],
    ['a POSTGRES_PASSWORD Actions secret', 'POSTGRES_PASSWORD: ${{ secrets.DB_PASSWORD }}'],
    ['a DB_PASSWORD placeholder', 'DB_PASSWORD=<password>'],
    ['a masked SUPABASE_DB_PASSWORD', 'SUPABASE_DB_PASSWORD=****'],
    ['a bracketed DATABASE_PASSWORD', 'DATABASE_PASSWORD=[your-password]'],
    ['an empty PG_PASSWORD', 'PG_PASSWORD='],
    ['supabase --password from a variable', 'supabase db push --password "$SUPABASE_DB_PASSWORD"'],
    ['supabase --password=${VAR}', 'supabase link --password=${SUPABASE_DB_PASSWORD}'],
    ['supabase -p placeholder', 'supabase db dump -p <password>'],
    ['mkdir -p after a supabase directory', 'cd supabase && mkdir -p migrations/archive'],
    ['a JS constant with spaces around `=`', `const PASSWORD = 'imap-password';`],
    [
      'a JS PASSWORD read from the environment with a fallback',
      `const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'demo-password-123';`,
    ],
    ['a PW variable read from another variable', 'PW=$OTHER_PASSWORD psql "$DATABASE_URL"'],
    ['a PW variable set to ${VAR}', 'PW=${DB_PASSWORD}'],
    ['a DB_PASS placeholder', 'DB_PASS=<password>'],
    ['a masked PGPASS', 'PGPASS=****'],
    ['a short PW value', 'PW=abc'],
    ['an empty DB_PASSWD', 'DB_PASSWD='],
    ['a PASSWORD assignment to the throwaway postgres value', 'POSTGRES_PASS="postgres"'],
    ['a shell PWD path', 'PWD=/home/user/alfred/frontend npm test'],
    ['a role password placeholder', `alter role alfred_reader with login password '<password>';`],
    ['a masked role password', `create role x login password '****'`],
    ['a role password read from a psql variable', `alter role x password :'pw';`],
    ['a short role password', `alter role x password 'abc'`],
    ['a .pgpass placeholder', `${POOLER_HOST}:5432:postgres:postgres.ref:<password>`],
    ['a .pgpass masked password', `${POOLER_HOST}:5432:postgres:postgres.ref:*****`],
    ['a colon-separated timestamp', 'started 2026:09:29:10:45:33.123 ok'],
    ['a Supabase token placeholder', 'SUPABASE_ACCESS_TOKEN=sbp_v0_<token>'],
    ['a short sbp_ prefix', 'sbp_v0_abc123'],
  ])('passes %s', async (_shape, line) => {
    const result = await scanOne('demo.md', `${line}\n`);
    expect(result.ok).toBe(true);
  });

  it('skips a file that starts with a known binary format, like a PNG', async () => {
    write('shot.png', Buffer.concat([PNG, Buffer.from([0x00, 0x00]), Buffer.from(LEAKED_URI)]));
    const result = await scanFiles(repo, ['shot.png']);
    expect(result).toEqual({ ok: true, output: '', scanned: 0 });
  });

  it('still scans a text file with a stray NUL byte in it (not "binary")', async () => {
    write('notes.md', Buffer.concat([Buffer.from('x\0\n'), Buffer.from(`${LEAKED_URI}\n`)]));
    const result = await scanFiles(repo, ['notes.md']);
    expect(result.ok).toBe(false);
    expect(result.scanned).toBe(1);
  });

  it.each([
    ['little-endian', 'le' as const],
    ['big-endian', 'be' as const],
  ])('scans a %s UTF-16 file with a BOM', async (_order, order) => {
    write('notes.md', utf16(`${LEAKED_URI}\n`, order));
    const result = await scanFiles(repo, ['notes.md']);
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain(PASSWORD);
  });

  it('reports how many files it actually scanned', async () => {
    write('a.md', 'hello\n');
    write('b.md', 'world\n');
    const result = await scanFiles(repo, ['a.md', 'b.md']);
    expect(result).toEqual({ ok: true, output: '', scanned: 2 });
  });
});

describe('committableFiles', () => {
  it('lists tracked files, including ones staged but not yet committed', () => {
    write('committed.md', 'a\n');
    git('add', 'committed.md');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
    write('nested/staged.md', 'b\n');
    git('add', 'nested/staged.md');
    expect(committableFiles(repo)).toEqual(['committed.md', 'nested/staged.md']);
  });

  it('lists a new file not yet staged, since the gate can run before `git add` (batch-commits does)', () => {
    write('committed.md', 'a\n');
    git('add', 'committed.md');
    write('nested/new.ts', 'b\n');
    expect(new Set(committableFiles(repo))).toEqual(new Set(['committed.md', 'nested/new.ts']));
  });

  it('never lists a gitignored file (.env.local), so local secrets cannot fail the gate', () => {
    write('.gitignore', '.env*\n');
    write('.env.local', `DATABASE_URL=${LEAKED_URI}\n`);
    git('add', '.gitignore');
    expect(committableFiles(repo)).toEqual(['.gitignore']);
  });

  it('skips a tracked file deleted from the working tree', () => {
    write('gone.md', 'a\n');
    write('kept.md', 'b\n');
    git('add', '.');
    rmSync(path.join(repo, 'gone.md'));
    expect(committableFiles(repo)).toEqual(['kept.md']);
  });

  it('lists a symlink itself, to be scanned as its link text', () => {
    write('dir/inner.md', 'b\n');
    symlinkSync('dir', path.join(repo, 'link'));
    git('add', '.');
    expect(committableFiles(repo)).toEqual(['dir/inner.md', 'link']);
  });

  it('skips a gitlink (submodule) directory', () => {
    write('a.md', 'a\n');
    commit('init');
    git('update-index', '--add', '--cacheinfo', `160000,${gitOut('rev-parse', 'HEAD')},sub`);
    mkdirSync(path.join(repo, 'sub'));
    expect(committableFiles(repo)).toEqual(['a.md']);
  });
});

describe('symlinks in the working tree', () => {
  it('scans the link text, not the target it points at', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'secret-scan-outside-'));
    try {
      writeFileSync(path.join(outside, 'secret.md'), `${LEAKED_URI}\n`);
      symlinkSync(path.join(outside, 'secret.md'), path.join(repo, 'link.md'));
      const result = await scanFiles(repo, ['link.md']);
      expect(result.ok).toBe(true);
      expect(result.scanned).toBe(1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('flags a secret written as the link text itself', async () => {
    symlinkSync(LEAKED_URI, path.join(repo, 'link.md'));
    const result = await scanFiles(repo, ['link.md']);
    expect(result.ok).toBe(false);
  });

  it('does not read through a symlink to a directory', async () => {
    mkdirSync(path.join(repo, 'dir'));
    symlinkSync('dir', path.join(repo, 'link'));
    const result = await scanFiles(repo, ['link']);
    expect(result).toEqual({ ok: true, output: '', scanned: 1 });
  });
});

describe('stagedEntries', () => {
  it('scans what will be committed, even when the working copy was cleaned or deleted', async () => {
    write('a.md', `${LEAKED_URI}\n`);
    write('b.md', `${LEAKED_URI}\n`);
    git('add', 'a.md', 'b.md');
    write('a.md', 'clean\n');
    rmSync(path.join(repo, 'b.md'));
    const onDisk = await scanFiles(repo, committableFiles(repo));
    expect(onDisk.ok).toBe(true);
    const staged = stagedEntries(repo);
    expect(staged.map((entry) => entry.label)).toEqual(['a.md (staged)', 'b.md (staged)']);
    const result = await scanEntries(staged);
    expect(result.ok).toBe(false);
  });

  it('lists nothing when the index matches HEAD', () => {
    write('a.md', 'a\n');
    commit('init');
    expect(stagedEntries(repo)).toEqual([]);
  });

  it('reads a path like `0:foo` by blob id, not as stage-0 of `foo`', async () => {
    write('foo', 'clean\n');
    write('0:foo', `${LEAKED_URI}\n`);
    git('add', '--', 'foo', '0:foo');
    const entries = stagedEntries(repo);
    expect(entries.map((entry) => entry.label)).toEqual(['0:foo (staged)', 'foo (staged)']);
    const result = await scanEntries(entries);
    expect(result.ok).toBe(false);
  });

  it('includes a type change (regular file staged as a symlink)', async () => {
    write('a.md', 'a\n');
    commit('init');
    rmSync(path.join(repo, 'a.md'));
    symlinkSync(LEAKED_URI, path.join(repo, 'a.md'));
    git('add', 'a.md');
    expect(gitOut('diff', '--cached', '--name-status')).toBe('T\ta.md');
    const entries = stagedEntries(repo);
    expect(entries.map((entry) => entry.label)).toEqual(['a.md (staged)']);
    const result = await scanEntries(entries);
    expect(result.ok).toBe(false);
  });

  it('skips a staged gitlink and a deleted path', () => {
    write('a.md', 'a\n');
    write('b.md', 'b\n');
    commit('init');
    git('update-index', '--add', '--cacheinfo', `160000,${gitOut('rev-parse', 'HEAD')},sub`);
    git('rm', '--quiet', 'b.md');
    expect(stagedEntries(repo)).toEqual([]);
  });
});

describe('rangeEntries', () => {
  it('scans every commit in the range, so a secret added then removed is still caught', async () => {
    write('base.md', 'base\n');
    commit('base');
    write('a.md', `${LEAKED_URI}\n`);
    commit('add');
    write('a.md', 'scrubbed\n');
    commit('scrub');
    const tip = await scanFiles(repo, committableFiles(repo));
    expect(tip.ok).toBe(true);
    const entries = rangeEntries(repo, 'HEAD~2..HEAD');
    expect(entries.map((entry) => entry.content)).toContain(`${LEAKED_URI}\n`);
    const result = await scanEntries(entries);
    expect(result.ok).toBe(false);
  });

  it('skips a deleted path and a binary blob', () => {
    write('gone.md', 'x\n');
    commit('base');
    rmSync(path.join(repo, 'gone.md'));
    write('shot.png', Buffer.concat([PNG, Buffer.from([0x00, 0x01])]));
    commit('change');
    expect(rangeEntries(repo, 'HEAD~1..HEAD')).toEqual([]);
  });

  it('scans the resolution of a merge commit, which a plain diff-tree prints nothing for', async () => {
    write('a.md', 'a\n');
    commit('base');
    git('branch', '-M', 'main');
    git('checkout', '--quiet', '-b', 'feature');
    write('feature.md', 'f\n');
    commit('feature');
    git('checkout', '--quiet', 'main');
    write('main.md', 'm\n');
    commit('main');
    git('merge', '--quiet', '--no-ff', '--no-commit', 'feature');
    write('evil.md', `${LEAKED_URI}\n`);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'merge');
    expect(gitOut('rev-list', '--parents', '-n1', 'HEAD').split(' ')).toHaveLength(3);
    const entries = rangeEntries(repo, 'HEAD~1..HEAD');
    expect(entries.map((entry) => entry.label.split(':', 2)[1])).toContain('evil.md');
    const result = await scanEntries(entries);
    expect(result.ok).toBe(false);
  });

  it('scans a type change (regular file replaced by a symlink)', async () => {
    write('a.md', 'a\n');
    commit('base');
    rmSync(path.join(repo, 'a.md'));
    symlinkSync(LEAKED_URI, path.join(repo, 'a.md'));
    commit('typechange');
    expect(gitOut('diff', '--name-status', 'HEAD~1', 'HEAD')).toBe('T\ta.md');
    const result = await scanEntries(rangeEntries(repo, 'HEAD~1..HEAD'));
    expect(result.ok).toBe(false);
  });

  it('skips a gitlink instead of failing to read it as a blob', () => {
    write('a.md', 'a\n');
    commit('base');
    git('update-index', '--add', '--cacheinfo', `160000,${gitOut('rev-parse', 'HEAD')},sub`);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'sub');
    expect(rangeEntries(repo, 'HEAD~1..HEAD')).toEqual([]);
  });

  it('includes the root commit and scans each distinct blob once', () => {
    write('a.md', 'same\n');
    write('b.md', 'same\n');
    commit('root');
    expect(rangeEntries(repo, 'HEAD')).toHaveLength(1);
  });

  it('takes a list of revisions, including exclusions, and reads a path with odd characters', () => {
    write('base.md', 'base\n');
    commit('base');
    write('a b/0:x.md', 'new\n');
    commit('add');
    const entries = rangeEntries(repo, ['HEAD', '--not', 'HEAD~1']);
    expect(entries.map((entry) => entry.label.split(':').slice(1).join(':'))).toEqual([
      'a b/0:x.md',
    ]);
  });

  it('refuses a range that could be read as a git option', () => {
    expect(() => rangeEntries(repo, '--output=x')).toThrow(/range/);
  });

  it('fails with a message that carries no blob bytes when git fails', () => {
    write('a.md', `${LEAKED_URI}\n`);
    commit('base');
    const message = failureOf(() => rangeEntries(repo, 'nosuchref..HEAD'));
    expect(message).toMatch(/git log/);
    expect(message).not.toContain(PASSWORD);
  });
});

describe('branchRange', () => {
  it('is origin/main..HEAD — the commits this branch would publish', () => {
    write('a.md', 'a\n');
    commit('trunk');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write('b.md', 'b\n');
    commit('feature');
    expect(branchRange(repo)).toBe('origin/main..HEAD');
    expect(
      rangeEntries(repo, branchRange(repo)).map((entry) => entry.label.split(':', 2)[1]),
    ).toEqual(['b.md']);
  });

  it('fails closed, with a clear message, when there is no origin/main to measure from', () => {
    write('a.md', 'a\n');
    commit('only');
    expect(() => branchRange(repo)).toThrow(/origin\/main/);
  });
});

describe('pushRevs', () => {
  const ZEROS = '0'.repeat(40);

  it('excludes what the remote already has, for each non-delete line', () => {
    write('a.md', 'a\n');
    commit('a');
    const sha = gitOut('rev-parse', 'HEAD');
    const stdin = `refs/heads/topic ${sha} refs/heads/topic ${ZEROS}\n`;
    expect(pushRevs(repo, 'origin', stdin)).toEqual([sha, '--not', '--remotes=origin']);
  });

  it('also excludes the remote tip it is replacing, when that object is known locally', () => {
    write('a.md', 'a\n');
    commit('a');
    const old = gitOut('rev-parse', 'HEAD');
    write('b.md', 'b\n');
    commit('b');
    const sha = gitOut('rev-parse', 'HEAD');
    const unknown = 'f'.repeat(40);
    const stdin = [
      `refs/heads/x ${sha} refs/heads/x ${old}`,
      `refs/heads/y ${sha} refs/heads/y ${unknown}`,
    ].join('\n');
    expect(pushRevs(repo, 'origin', stdin)).toEqual([sha, '--not', '--remotes=origin', old]);
  });

  it('ignores deletions and blank input, so there is nothing to scan', () => {
    const stdin = `(delete) ${ZEROS} refs/heads/gone ${'a'.repeat(40)}\n\n`;
    expect(pushRevs(repo, 'origin', stdin)).toEqual([]);
    expect(pushRevs(repo, 'origin', '')).toEqual([]);
  });

  it('rejects a line that is not the four fields git sends', () => {
    expect(() => pushRevs(repo, 'origin', 'refs/heads/x nothex refs/heads/x')).toThrow(/pre-push/);
    expect(() => pushRevs(repo, 'origin', `a ${'b'.repeat(40)} c d e`)).toThrow(/pre-push/);
    expect(() => pushRevs(repo, 'origin', `a not-a-sha c ${ZEROS}`)).toThrow(/pre-push/);
  });
});

describe('hasBinaryMagic', () => {
  it.each([
    ['PNG', PNG],
    ['GIF', GIF],
    ['JPEG', JPEG],
    ['WebP', WEBP],
    ['WOFF', Buffer.from('wOFF\0\u0001')],
    ['WOFF2', Buffer.from('wOF2\0\u0001')],
    ['PDF', PDF],
    ['ZIP', ZIP],
    ['gzip', GZIP],
  ])('recognises %s', (_format, header) => {
    expect(hasBinaryMagic(Buffer.concat([header, Buffer.from('rest')]))).toBe(true);
  });

  it('does not treat text, or text with NUL bytes, as binary', () => {
    expect(hasBinaryMagic(Buffer.from('plain text\n'))).toBe(false);
    expect(hasBinaryMagic(Buffer.from([0x41, 0x00, 0x42]))).toBe(false);
    expect(hasBinaryMagic(Buffer.alloc(0))).toBe(false);
  });

  it('is not fooled by a RIFF container that is not WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from('WAVE'),
    ]);
    expect(hasBinaryMagic(wav)).toBe(false);
  });
});

describe('decodeText', () => {
  it('replaces NUL bytes with newlines instead of giving up on the file', () => {
    expect(decodeText(Buffer.from('a\0b\0'))).toBe('a\nb\n');
  });

  it('decodes UTF-16 with a BOM of either byte order, dropping the BOM', () => {
    expect(decodeText(utf16('hello\n', 'le'))).toBe('hello\n');
    expect(decodeText(utf16('hello\n', 'be'))).toBe('hello\n');
  });

  it('returns undefined for a known binary format', () => {
    expect(decodeText(Buffer.concat([PNG, Buffer.from('x')]))).toBeUndefined();
  });

  it('decodes plain UTF-8 as is', () => {
    expect(decodeText(Buffer.from('héllo'))).toBe('héllo');
  });
});
