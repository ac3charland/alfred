import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import { envRootsFor, findConfigFile, findSecrets, findSecretsIn } from './secrets.ts';

// The engine loads secretlint and its rules on first use.
jest.setTimeout(60_000);

// Assembled at runtime so this file stays clean under the very scan it tests.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.abcdefghijklmnop:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;

describe('findConfigFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'showboat-secrets-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the config in the start directory', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    expect(findConfigFile(root)).toBe(path.join(root, '.secretlintrc.json'));
  });

  it('walks up parent directories until it finds the config', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    const deep = path.join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBe(path.join(root, '.secretlintrc.json'));
  });

  it('prefers the nearest config', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    const inner = path.join(root, 'inner');
    mkdirSync(inner);
    writeFileSync(path.join(inner, '.secretlintrc.json'), '{}');
    expect(findConfigFile(inner)).toBe(path.join(inner, '.secretlintrc.json'));
  });

  it('throws (fails closed) when no directory up to the root has one', () => {
    // A temp dir has no config above it; if a machine ever did, this would need a different root.
    expect(() => findConfigFile(root)).toThrow(/\.secretlintrc\.json/);
  });

  it('finds the repo config from this module, wherever a sandbox copy of it runs', () => {
    const found = findConfigFile(import.meta.dirname);
    expect(path.basename(found)).toBe('.secretlintrc.json');
    expect(import.meta.dirname.startsWith(path.dirname(found) + path.sep)).toBe(true);
    expect(readFileSync(found, 'utf8')).toContain('rules');
  });
});

describe('findSecrets', () => {
  const saved = process.env['PGPASSWORD'];

  afterEach(() => {
    if (saved === undefined) delete process.env['PGPASSWORD'];
    else process.env['PGPASSWORD'] = saved;
  });

  it('returns undefined for clean content', async () => {
    delete process.env['PGPASSWORD'];
    expect(await findSecrets('hello world', '<note>')).toBeUndefined();
  });

  it('still reports a pattern match, masked and headed by the label', async () => {
    delete process.env['PGPASSWORD'];
    const report = await findSecrets(`psql ${LEAKED_URI}`, '<command>');
    expect(report).toContain('<command>');
    expect(report).not.toContain(PASSWORD);
  });

  it('refuses a bare live password no pattern would catch, without printing it', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const report = await findSecrets(`$ printenv PGPASSWORD\n${PASSWORD}\n`, '<command output>');
    expect(report).toContain('<command output>');
    expect(report).toContain('contains the value of $PGPASSWORD');
    expect(report).not.toContain(PASSWORD);
  });

  it('refuses a live value in node inspect output', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    expect(await findSecrets(`{ password: '${PASSWORD}' }`, '<command output>')).toContain(
      '$PGPASSWORD',
    );
  });

  it('refuses UTF-16 output holding a live value', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const utf16 = `${PASSWORD}\n`.replaceAll(/(?<=.)(?=.)/gs, '\0');
    expect(await findSecrets(utf16, '<command output>')).toContain('$PGPASSWORD');
  });

  it('reports both the pattern finding and the live value', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const report = await findSecrets(`${LEAKED_URI}\nand ${PASSWORD}`, '<note>');
    expect(report).toContain('PostgreSQL');
    expect(report).toMatch(/\n<note>\n {2}contains the value of \$PGPASSWORD/);
    expect(report).toContain('contains the value of $PGPASSWORD');
    expect(report).not.toContain(PASSWORD);
  });

  it('cannot be silenced by a secretlint-disable comment', async () => {
    delete process.env['PGPASSWORD'];
    const report = await findSecrets(`<!-- secretlint-disable -->\n${LEAKED_URI}`, '<note>');
    expect(report).toContain('PostgreSQL');
  });

  it('ignores a trivial live value', async () => {
    process.env['PGPASSWORD'] = 'postgres';
    expect(await findSecrets('user postgres, password postgres', '<note>')).toBeUndefined();
  });
});

/** git with the repo-locating variables a hook exports removed, so it acts on `cwd`. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  execFileSync('git', args, { cwd, env, stdio: 'ignore' });
}

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

describe('findSecretsIn: the gitignored dotenv files of the given roots', () => {
  let base: string;
  let main: string;
  let linked: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'showboat-env-')));
    main = path.join(base, 'main');
    linked = path.join(base, 'linked');
    mkdirSync(main);
    git(main, 'init', '--quiet', '-b', 'main');
    write(main, '.gitignore', '.env*\n.dev.vars*\n');
    write(main, '.secretlintrc.json', '{}');
    git(main, 'add', '.');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'feature');
  });

  afterEach(() => {
    delete process.env['PGPASSWORD'];
    rmSync(base, { recursive: true, force: true });
  });

  it('refuses a value held in a dotenv file of the roots, naming the file but not the value', async () => {
    write(main, 'workers/.dev.vars', `GMAIL_ALFRED_REFRESH_TOKEN=${PASSWORD}\n`);
    const report = await findSecretsIn(`token: ${PASSWORD}`, '<command output>', [main]);
    expect(report).toContain('<command output>');
    expect(report).toContain(
      'contains the value of GMAIL_ALFRED_REFRESH_TOKEN in workers/.dev.vars',
    );
    expect(report).not.toContain(PASSWORD);
  });

  it('is clean when the roots hold no such value', async () => {
    write(main, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}\n`);
    expect(await findSecretsIn('nothing here', '<note>', [main])).toBeUndefined();
    expect(await findSecretsIn(PASSWORD, '<note>', [])).toBeUndefined();
  });

  it('reads the main checkout env files when run from a linked worktree', async () => {
    write(main, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}\n`);
    const roots = envRootsFor(path.join(linked, '.secretlintrc.json'));
    expect(roots).toEqual([linked, main]);
    expect(await findSecretsIn(PASSWORD, '<note>', roots)).toContain(
      'contains the value of MY_API_SECRET in frontend/.env.local',
    );
    expect(await findSecretsIn(PASSWORD, '<note>', [linked])).toBeUndefined();
  });
});

describe('envRootsFor', () => {
  it('names the repo this module lives in, where showboat reads its env files from', () => {
    const configDir = path.dirname(findConfigFile(import.meta.dirname));
    expect(envRootsFor(path.join(configDir, '.secretlintrc.json'))).toContain(
      realpathSync(configDir),
    );
  });

  it('falls back to the config directory without git', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'showboat-nogit-'));
    try {
      expect(envRootsFor(path.join(dir, '.secretlintrc.json'))).toEqual([dir]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
