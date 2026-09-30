import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  findKnownSecrets,
  isTrivialValue,
  knownSecrets,
  knownSecretsReport,
  repoEnvRoots,
} from './known-secrets.ts';

// Assembled at runtime so this file stays clean under the very scan it tests.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const OTHER = ['Hm4', 'nB8s', 'Yc3dK'].join('');
const THIRD = ['Ur5', 'eW1q', 'Ld6oV'].join('');
const SPECIAL = ['p@ss/w', 'ord#', '9Zq!x'].join('');
// A human-chosen lowercase passphrase: fine for a password, would be a false positive for a token.
const PHRASE = ['correct', 'horse', 'bat'].join('');

function sources(
  content: string,
  env: Record<string, string>,
  envRoots?: readonly string[],
): string[] {
  return findKnownSecrets(content, knownSecrets({ env, ...(envRoots ? { envRoots } : {}) }));
}

/** git with the repo-locating variables a hook exports removed, so it acts on `cwd`. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const GITIGNORE = ['.env', '.env.*', '.dev.vars', '.dev.vars.*', '!*.example', ''].join('\n');

/** A git repo whose dotenv files are ignored, like alfred's. */
function initRepo(root: string): void {
  git(root, 'init', '--quiet', '-b', 'main');
  write(root, '.gitignore', GITIGNORE);
  git(root, 'add', '.gitignore');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
}

describe('isTrivialValue', () => {
  it.each([
    ['empty', ''],
    ['too short', 'Ab3$xY9'],
    ['a short lowercase word', 'postgres'],
    ['a lowercase word just under 16', 'passwordpassword'.slice(0, 15)],
    ['a word with separators', 'proxy-managed'],
    ['an angle-bracket placeholder', '<your-password-here>'],
    ['asterisks', '********'],
    ['changeme', 'ChangeMe'],
    ['a variable reference', '${DB_PASSWORD}'],
    ['one repeated character', '00000000000'],
  ])('ignores %s', (_case, value) => {
    expect(isTrivialValue(value)).toBe(true);
  });

  it.each([
    ['a password-shaped lowercase word', PHRASE],
    ['a mixed-case password', PASSWORD],
  ])('keeps %s when it is a password', (_case, value) => {
    expect(isTrivialValue(value, true)).toBe(false);
  });

  it('still treats a lowercase word as trivial when it is not a password', () => {
    expect(isTrivialValue(PHRASE)).toBe(true);
  });

  it.each(['postgres', 'Password', 'passw0rd', 'secret', 'ADMIN', 'root', 'example', 'test'])(
    'ignores the well-known default password %s',
    (value) => {
      expect(isTrivialValue(value, true)).toBe(true);
    },
  );

  it.each([
    ['too short', 'Ab3$xY9'],
    ['a placeholder', '<your-password-here>'],
    ['asterisks', '********'],
    ['changeme', 'ChangeMe'],
    ['a variable reference', '${DB_PASSWORD}'],
    ['one repeated character', '00000000000'],
  ])('still ignores %s as a password', (_case, value) => {
    expect(isTrivialValue(value, true)).toBe(true);
  });

  it.each([
    ['a mixed-case password', PASSWORD],
    ['a long lowercase passphrase', 'correcthorsebatterystaple'],
    ['a digit-bearing token', 'abcdefgh12345'],
  ])('keeps %s', (_case, value) => {
    expect(isTrivialValue(value)).toBe(false);
  });
});

describe('knownSecrets sources', () => {
  it('reads PGPASSWORD', () => {
    expect(sources(`x ${PASSWORD} y`, { PGPASSWORD: PASSWORD })).toEqual([
      'the value of $PGPASSWORD',
    ]);
  });

  it('reads any variable whose name looks like a credential', () => {
    const env = { MY_API_SECRET: PASSWORD, DB_PWD: OTHER, SOME_TOKEN: THIRD };
    expect(sources(OTHER, env)).toEqual(['the value of $DB_PWD']);
    expect(sources(THIRD, env)).toEqual(['the value of $SOME_TOKEN']);
    expect(sources(PASSWORD, env)).toEqual(['the value of $MY_API_SECRET']);
  });

  it('reads SUPABASE_ACCESS_TOKEN', () => {
    expect(sources(PASSWORD, { SUPABASE_ACCESS_TOKEN: PASSWORD })).toEqual([
      'the value of $SUPABASE_ACCESS_TOKEN',
    ]);
  });

  it('ignores variables whose name does not look like a credential', () => {
    expect(sources(PASSWORD, { HOME_DIRECTORY_NAME: PASSWORD })).toEqual([]);
  });

  it.each(['PWD', 'OLDPWD', 'CLAUDE_TOKEN_FILE', 'GIT_CONFIG_KEY_0', 'X_KEY_PATH'])(
    'ignores %s, which holds a location or a config name, not a secret',
    (name) => {
      expect(sources(PASSWORD, { [name]: PASSWORD })).toEqual([]);
    },
  );

  it('takes the password and the whole URL from DATABASE_URL', () => {
    const url = `postgresql://postgres.ref:${PASSWORD}@aws-1.pooler.example.com:5432/postgres`;
    const env = { DATABASE_URL: url };
    expect(sources(`printenv says ${PASSWORD}`, env)).toEqual(['the password from $DATABASE_URL']);
    expect(sources(`connect ${url}`, env)).toEqual(
      expect.arrayContaining(['the password from $DATABASE_URL', 'the value of $DATABASE_URL']),
    );
  });

  it('takes the percent-decoded password from SUPABASE_DB_URL', () => {
    const url = `postgresql://u:${encodeURIComponent(SPECIAL)}@host.example.com:5432/postgres`;
    const env = { SUPABASE_DB_URL: url };
    expect(sources(`{ password: '${SPECIAL}' }`, env)).toEqual([
      'the password from $SUPABASE_DB_URL',
    ]);
    expect(sources(`the encoded form ${encodeURIComponent(SPECIAL)}`, env)).toEqual([
      'the password from $SUPABASE_DB_URL',
    ]);
  });

  it('handles an unencoded @ and / inside a URL password', () => {
    const env = { DATABASE_URL: `postgresql://u:${SPECIAL}@host.example.com/postgres` };
    expect(sources(SPECIAL, env)).toEqual(['the password from $DATABASE_URL']);
  });

  it('ignores a URL whose password is trivial, or that has none', () => {
    const env = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      SUPABASE_DB_URL: 'postgresql://localhost:5432/postgres',
    };
    expect(sources(`${env.DATABASE_URL} ${env.SUPABASE_DB_URL}`, env)).toEqual([]);
  });

  it('treats a credential-named URL variable like a database URL', () => {
    const env = { CACHE_URL: `redis://default:${PASSWORD}@cache.example.com:6379` };
    expect(sources(PASSWORD, env)).toEqual(['the password from $CACHE_URL']);
  });

  it('ignores a URL variable with no embedded password', () => {
    const env = { CACHE_URL: 'redis://cache.example.com:6379/0' };
    expect(sources('redis://cache.example.com:6379/0', env)).toEqual([]);
  });

  it.each(['SUPABASE_DB_PASSWORD', 'DB_PWD', 'PGPASSWORD'])(
    'keeps a human-chosen lowercase password held by %s',
    (name) => {
      expect(sources(PHRASE, { [name]: PHRASE })).toEqual([`the value of $${name}`]);
    },
  );

  it('keeps the lowercase-word rule for a token or key, which is generated', () => {
    expect(sources(PHRASE, { SOME_TOKEN: PHRASE, MY_API_KEY: PHRASE })).toEqual([]);
  });

  it('keeps a lowercase URL password, and ignores a default one', () => {
    const env = { DATABASE_URL: `postgresql://u:${PHRASE}@host.example.com:5432/postgres` };
    expect(sources(PHRASE, env)).toEqual(['the password from $DATABASE_URL']);
    const local = { DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres' };
    expect(sources('password postgresql://postgres:password@localhost', local)).toEqual([]);
  });

  it('ignores trivial and placeholder values', () => {
    const env = {
      PGPASSWORD: 'postgres',
      DB_PASSWORD: '<password>',
      SOME_KEY: '****',
      OTHER_TOKEN: 'changeme',
      EMPTY_SECRET: '',
      SHORT_PASS: 'Ab3$xY9',
    };
    expect(sources('postgres <password> **** changeme Ab3$xY9', env)).toEqual([]);
  });
});

describe('knownSecrets URL values', () => {
  const at = `host.example.com:5432/postgres`;

  it('does not read a port, path and query as the password of a greedy match', () => {
    // Greedy to the last @, `h:443/x?u=a@b` looks like user `h`, password `443/x?u=a`; it is not.
    const url = ['https://h:443', '/x?u=', 'a@b'].join('');
    const env = { CALLBACK_URL: url };
    expect(sources(`${url} 443/x?u=a`, env)).toEqual([]);
  });

  it('still reads an unencoded @ and / password when the WHATWG parse throws', () => {
    const password = ['Xk3@', 'vLm8', 'Rw2pT'].join('');
    const url = `postgresql://u:${password}@host.example.com:port/postgres`;
    expect(() => new URL(url)).toThrow();
    expect(sources(password, { DATABASE_URL: url })).toEqual(['the password from $DATABASE_URL']);
  });

  it('takes the password query parameter of a URL', () => {
    const env = { DATABASE_URL: `postgresql://user@${at}?sslmode=require&password=${PASSWORD}` };
    expect(sources(PASSWORD, env)).toEqual(['the password from $DATABASE_URL']);
  });

  it('takes a percent-encoded password query key and decodes its value', () => {
    const env = {
      DATABASE_URL: `postgresql://user@${at}?pass%77ord=${encodeURIComponent(SPECIAL)}`,
    };
    expect(sources(SPECIAL, env)).toEqual(['the password from $DATABASE_URL']);
  });

  it('takes both the userinfo password and the query password', () => {
    const env = { DATABASE_URL: `postgresql://user:${PASSWORD}@${at}?password=${OTHER}` };
    expect(sources(PASSWORD, env)).toEqual(['the password from $DATABASE_URL']);
    expect(sources(OTHER, env)).toEqual(['the password from $DATABASE_URL']);
  });

  it('ignores a trivial query password', () => {
    const trivial = ['post', 'gres'].join('');
    const env = { DATABASE_URL: `postgresql://user@${at}?password=${trivial}` };
    expect(sources(`${trivial} ${env.DATABASE_URL}`, env)).toEqual([]);
  });

  it.each([
    'POSTGRES_URL_NON_POOLING',
    'DATABASE_URL_UNPOOLED',
    'PG_CONNECTION',
    'PGURI',
    'CONNECTION_STRING',
  ])('takes the password of a URL held by %s, whatever the name', (name) => {
    const env = { [name]: `postgresql://user:${PASSWORD}@${at}` };
    expect(sources(PASSWORD, env)).toEqual([`the password from $${name}`]);
  });

  it('still ignores a non-credential variable holding a URL without a password', () => {
    const env = { PG_CONNECTION: `postgresql://user@${at}` };
    expect(sources(`postgresql://user@${at}`, env)).toEqual([]);
  });
});

describe('knownSecrets names and values', () => {
  it.each(['SUPABASE_SERVICE_ROLE_JWT', 'GOOGLE_CREDENTIALS', 'AWS_CREDENTIAL'])(
    'reads %s',
    (name) => {
      expect(sources(PASSWORD, { [name]: PASSWORD })).toEqual([`the value of $${name}`]);
    },
  );

  it('does not read a variable that merely contains AUTH', () => {
    expect(sources(PASSWORD, { PR_RATIO_AUTHORS: PASSWORD })).toEqual([]);
  });

  it.each([
    'SSH_ASKPASS',
    'GIT_ASKPASS',
    'SUDO_ASKPASS',
    'PGPASSFILE',
    'PGSSLKEY',
    'PGSSLROOTCERT',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_API_TOKEN',
    'SOME_SECRET_HOME',
    'MY_KEY_DIR',
  ])('ignores %s, which holds a location or public value', (name) => {
    expect(sources(PASSWORD, { [name]: PASSWORD })).toEqual([]);
  });

  it('still reads PGSSLPASSWORD, a real passphrase', () => {
    expect(sources(PASSWORD, { PGSSLPASSWORD: PASSWORD })).toEqual(['the value of $PGSSLPASSWORD']);
  });

  it.each([
    ['an absolute path', '/usr/lib/openssh/gnome-ssh-askpass'],
    ['a nested absolute path', '/home/user/.config/secret-tool/token'],
    ['a flag', '--password-stdin-value'],
  ])('ignores a credential-named variable holding %s', (_case, value) => {
    expect(sources(value, { SOME_TOKEN: value })).toEqual([]);
  });
});

describe('knownSecrets from gitignored dotenv files', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'known-secrets-'));
    initRepo(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const fromFile = (content: string): string[] => sources(content, {}, [root]);

  it('reads the password from a DATABASE_URL line and names the file', () => {
    write(
      root,
      'frontend/.env.local',
      `DATABASE_URL=postgresql://u:${PASSWORD}@host.example.com:5432/postgres\n`,
    );
    expect(fromFile(PASSWORD)).toEqual(['the password from DATABASE_URL in frontend/.env.local']);
  });

  it('parses dotenv lines: export, quotes, comments, blanks, CRLF', () => {
    write(
      root,
      'frontend/.env.local',
      [
        '# a comment',
        '',
        `export PGPASSWORD="${PASSWORD}"`,
        `MY_API_SECRET='${OTHER}'`,
        `SOME_TOKEN = ${THIRD}`,
        'NOT_A_LINE',
        `PLAIN_NAME=${SPECIAL}`,
      ].join('\r\n'),
    );
    expect(fromFile(PASSWORD)).toEqual(['the value of PGPASSWORD in frontend/.env.local']);
    expect(fromFile(OTHER)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
    expect(fromFile(THIRD)).toEqual(['the value of SOME_TOKEN in frontend/.env.local']);
    expect(fromFile(SPECIAL)).toEqual([]);
  });

  it('drops an inline comment after whitespace, or after a closing quote', () => {
    write(
      root,
      'frontend/.env.local',
      [
        `MY_API_SECRET=${PASSWORD} # the production key`,
        `SOME_TOKEN="${OTHER}" # quoted`,
        `PGPASSWORD='${THIRD}'   # single`,
        `X_SECRET=${SPECIAL}`,
      ].join('\n'),
    );
    expect(fromFile(PASSWORD)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
    expect(fromFile(OTHER)).toEqual(['the value of SOME_TOKEN in frontend/.env.local']);
    expect(fromFile(THIRD)).toEqual(['the value of PGPASSWORD in frontend/.env.local']);
    expect(fromFile('# the production key')).toEqual([]);
  });

  it('keeps a # that is not preceded by whitespace', () => {
    write(root, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}#frag\n`);
    expect(fromFile(`${PASSWORD}#frag`)).toEqual([
      'the value of MY_API_SECRET in frontend/.env.local',
    ]);
  });

  it('knows every assignment of a duplicated key, not just the last', () => {
    write(root, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}\nMY_API_SECRET=${OTHER}\n`);
    expect(fromFile(PASSWORD)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
    expect(fromFile(OTHER)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
  });

  it('knows the production DATABASE_URL when a local fixture is appended after it', () => {
    write(
      root,
      'frontend/.env.local',
      [
        `DATABASE_URL=postgresql://u:${PASSWORD}@host.example.com:5432/postgres`,
        'DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres',
        '',
      ].join('\n'),
    );
    expect(fromFile(PASSWORD)).toEqual(['the password from DATABASE_URL in frontend/.env.local']);
  });

  it('does not let an unclosed quote swallow the secrets on the lines after it', () => {
    write(
      root,
      'frontend/.env.local',
      [`NOTE="oops`, `MY_API_SECRET=${PASSWORD}`, `SOME_TOKEN="${OTHER}"`, ''].join('\n'),
    );
    expect(fromFile(PASSWORD)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
    expect(fromFile(OTHER)).toEqual(['the value of SOME_TOKEN in frontend/.env.local']);
  });

  it('knows a value whose opening quote never closes, without the quote', () => {
    write(root, 'frontend/.env.local', `MY_API_SECRET="${PASSWORD}\nSOME_TOKEN=${OTHER}\n`);
    expect(fromFile(PASSWORD)).toEqual(['the value of MY_API_SECRET in frontend/.env.local']);
    expect(fromFile(OTHER)).toEqual(['the value of SOME_TOKEN in frontend/.env.local']);
  });

  it('collects a double-quoted multi-line value whole, not its first line', () => {
    const value = `-----BEGIN PRIVATE KEY-----\n${PASSWORD}\n-----END PRIVATE KEY-----`;
    write(
      root,
      'frontend/.env.local',
      `GITHUB_APP_PRIVATE_KEY="${value}"\nOTHER_SECRET=${OTHER}\n`,
    );
    expect(fromFile(`key:\n${value}\n`)).toEqual([
      'the value of GITHUB_APP_PRIVATE_KEY in frontend/.env.local',
    ]);
    expect(fromFile('-----BEGIN PRIVATE KEY-----')).toEqual([]);
    expect(fromFile(OTHER)).toEqual(['the value of OTHER_SECRET in frontend/.env.local']);
  });

  it('reads workers/.dev.vars, database/.env and a root .env, naming each file', () => {
    write(root, 'workers/.dev.vars', `GMAIL_ALFRED_REFRESH_TOKEN=${PASSWORD}\n`);
    write(root, 'database/.env', `DB_SECRET=${OTHER}\n`);
    write(root, '.env', `ROOT_SECRET=${THIRD}\n`);
    write(root, 'frontend/.env.production', `SITE_API_KEY=${SPECIAL}\n`);
    expect(fromFile(PASSWORD)).toEqual([
      'the value of GMAIL_ALFRED_REFRESH_TOKEN in workers/.dev.vars',
    ]);
    expect(fromFile(OTHER)).toEqual(['the value of DB_SECRET in database/.env']);
    expect(fromFile(THIRD)).toEqual(['the value of ROOT_SECRET in .env']);
    expect(fromFile(SPECIAL)).toEqual(['the value of SITE_API_KEY in frontend/.env.production']);
  });

  it.each(['frontend/.env.example', 'frontend/.env.sample', 'workers/.dev.vars.template'])(
    'skips the template file %s',
    (file) => {
      write(root, file, `MY_API_SECRET=${PASSWORD}\n`);
      expect(fromFile(PASSWORD)).toEqual([]);
    },
  );

  it("never reads a dependency's env file under node_modules", () => {
    write(root, 'node_modules/some-pkg/.env', `FIXTURE_SECRET=${PASSWORD}\n`);
    write(root, 'frontend/node_modules/other/.dev.vars', `FIXTURE_TOKEN=${OTHER}\n`);
    expect(fromFile(PASSWORD)).toEqual([]);
    expect(fromFile(OTHER)).toEqual([]);
  });

  it('ignores a file that is not a dotenv file', () => {
    write(root, 'frontend/config.local', `MY_API_SECRET=${PASSWORD}\n`);
    expect(fromFile(PASSWORD)).toEqual([]);
  });

  it('is a no-op when there is no env file', () => {
    expect(fromFile(PASSWORD)).toEqual([]);
  });

  it('is a no-op for a root that does not exist', () => {
    expect(sources(PASSWORD, {}, [path.join(root, 'missing')])).toEqual([]);
  });

  it('reads the same files without git, from the root and its package directories', () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'known-secrets-plain-'));
    try {
      write(plain, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}\n`);
      write(plain, 'workers/.dev.vars', `GMAIL_X_TOKEN=${OTHER}\n`);
      write(plain, '.env', `ROOT_SECRET=${THIRD}\n`);
      write(plain, 'frontend/.env.example', `EX_SECRET=${SPECIAL}\n`);
      expect(sources(PASSWORD, {}, [plain])).toEqual([
        'the value of MY_API_SECRET in frontend/.env.local',
      ]);
      expect(sources(OTHER, {}, [plain])).toEqual([
        'the value of GMAIL_X_TOKEN in workers/.dev.vars',
      ]);
      expect(sources(THIRD, {}, [plain])).toEqual(['the value of ROOT_SECRET in .env']);
      expect(sources(SPECIAL, {}, [plain])).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('fails with the file and errno only when a file cannot be read', () => {
    // A symlink to a directory is listed by git as a file but reads as EISDIR.
    mkdirSync(path.join(root, 'frontend'));
    symlinkSync(root, path.join(root, 'frontend/.env.local'));
    let message = '';
    try {
      knownSecrets({ env: {}, envRoots: [root] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('cannot read frontend/.env.local: EISDIR');
  });
});

describe('repoEnvRoots and linked worktrees', () => {
  let base: string;
  let main: string;
  let linked: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'known-secrets-wt-')));
    main = path.join(base, 'main');
    linked = path.join(base, 'linked');
    mkdirSync(main);
    initRepo(main);
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'feature');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('names the checkout and the main worktree, once each', () => {
    expect(repoEnvRoots(linked)).toEqual([linked, main]);
    expect(repoEnvRoots(main)).toEqual([main]);
  });

  it('resolves the roots from a subdirectory', () => {
    mkdirSync(path.join(linked, 'sub'));
    expect(repoEnvRoots(path.join(linked, 'sub'))).toEqual([linked, main]);
  });

  it('falls back to the directory itself outside a repo', () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'known-secrets-plain-'));
    try {
      expect(repoEnvRoots(plain)).toEqual([plain]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('reads the main checkout env files from inside a linked worktree', () => {
    write(main, 'frontend/.env.local', `MY_API_SECRET=${PASSWORD}\n`);
    write(linked, 'workers/.dev.vars', `GMAIL_X_TOKEN=${OTHER}\n`);
    const roots = repoEnvRoots(linked);
    expect(sources(PASSWORD, {}, roots)).toEqual([
      'the value of MY_API_SECRET in frontend/.env.local',
    ]);
    expect(sources(OTHER, {}, roots)).toEqual(['the value of GMAIL_X_TOKEN in workers/.dev.vars']);
    // Without the main root the value is invisible — the fail-open this guards against.
    expect(sources(PASSWORD, {}, [linked])).toEqual([]);
  });
});

describe('findKnownSecrets variants', () => {
  const secrets = knownSecrets({ env: { PGPASSWORD: SPECIAL } });
  const expected = ['the value of $PGPASSWORD'];

  it.each([
    ['raw', SPECIAL],
    ['URL-encoded', encodeURIComponent(SPECIAL)],
    ['base64', Buffer.from(SPECIAL).toString('base64')],
    ['unpadded base64', Buffer.from(SPECIAL).toString('base64').replace(/=+$/, '')],
    ['base64url', Buffer.from(SPECIAL).toString('base64url')],
    ['JSON-escaped', JSON.stringify(`"${SPECIAL}\\`).slice(1, -1)],
  ])('finds the %s form', (_case, form) => {
    expect(findKnownSecrets(`before ${form} after`, secrets)).toEqual(expected);
  });

  it.each([0, 1, 2, 3, 4, 5, 8])(
    'finds base64 of user:value for a %i-character user, whatever its alignment',
    (length) => {
      const basic = Buffer.from(`${'u'.repeat(length)}:${SPECIAL}`).toString('base64');
      expect(findKnownSecrets(`Authorization: Basic ${basic}\n`, secrets)).toEqual(expected);
    },
  );

  it.each([0, 1, 2])('finds base64 of the value inside a longer blob (offset %i)', (offset) => {
    const blob = Buffer.from(`${'x'.repeat(offset)}${SPECIAL}:trailing-bytes`).toString('base64');
    expect(findKnownSecrets(`token=${blob}`, secrets)).toEqual(expected);
    const url = Buffer.from(`${'x'.repeat(offset)}${SPECIAL}:trailing-bytes`).toString('base64url');
    expect(findKnownSecrets(`token=${url}`, secrets)).toEqual(expected);
  });

  it('finds the value in NUL-interleaved UTF-16 output', () => {
    const utf16 = `PGPASSWORD=${SPECIAL}\n`.replaceAll(/(?<=.)(?=.)/gs, '\0');
    expect(findKnownSecrets(utf16, secrets)).toEqual(expected);
  });

  it('finds the value in text whose NULs were turned into newlines', () => {
    const decoded = `PGPASSWORD=${SPECIAL}`.replaceAll(/(?<=.)(?=.)/gs, '\n');
    expect(findKnownSecrets(decoded, secrets)).toEqual(expected);
  });

  it('finds nothing in unrelated content', () => {
    expect(findKnownSecrets('nothing to see here', secrets)).toEqual([]);
  });

  it('reports each source once', () => {
    const both = knownSecrets({ env: { PGPASSWORD: SPECIAL, MY_SECRET: SPECIAL } });
    expect(findKnownSecrets(`${SPECIAL} ${encodeURIComponent(SPECIAL)}`, both)).toHaveLength(1);
  });
});

describe('knownSecretsReport', () => {
  const secrets = knownSecrets({ env: { PGPASSWORD: PASSWORD } });

  it('names the label and the source but never the value', () => {
    const report = knownSecretsReport(`the password is ${PASSWORD}`, 'notes.md', secrets);
    expect(report).toContain('notes.md');
    expect(report).toContain('contains the value of $PGPASSWORD');
    expect(report).not.toContain(PASSWORD);
  });

  it('is undefined when nothing matches', () => {
    expect(knownSecretsReport('clean', 'notes.md', secrets)).toBeUndefined();
  });
});
