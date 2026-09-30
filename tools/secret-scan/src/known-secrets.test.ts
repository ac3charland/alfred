import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ENV_LOCAL_RELATIVE,
  findKnownSecrets,
  isTrivialValue,
  knownSecrets,
  knownSecretsReport,
} from './known-secrets.ts';

// Assembled at runtime so this file stays clean under the very scan it tests.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const OTHER = ['Hm4', 'nB8s', 'Yc3dK'].join('');
const THIRD = ['Ur5', 'eW1q', 'Ld6oV'].join('');
const SPECIAL = ['p@ss/w', 'ord#', '9Zq!x'].join('');

function sources(content: string, env: Record<string, string>, envFile?: string): string[] {
  return findKnownSecrets(content, knownSecrets({ env, ...(envFile ? { envFile } : {}) }));
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

describe('knownSecrets from frontend/.env.local', () => {
  let dir: string;
  let envFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'known-secrets-'));
    envFile = path.join(dir, '.env.local');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the password from a DATABASE_URL line', () => {
    writeFileSync(
      envFile,
      `DATABASE_URL=postgresql://u:${PASSWORD}@host.example.com:5432/postgres\n`,
    );
    expect(sources(PASSWORD, {}, envFile)).toEqual([
      `the password from DATABASE_URL in ${ENV_LOCAL_RELATIVE}`,
    ]);
  });

  it('parses dotenv lines: export, quotes, comments, blanks', () => {
    writeFileSync(
      envFile,
      [
        '# a comment',
        '',
        `export PGPASSWORD="${PASSWORD}"`,
        `MY_API_SECRET='${OTHER}'`,
        `SOME_TOKEN = ${THIRD}`,
        'NOT_A_LINE',
        `PLAIN_NAME=${SPECIAL}`,
      ].join('\n'),
    );
    const found = (content: string): string[] => sources(content, {}, envFile);
    expect(found(PASSWORD)).toEqual([`the value of PGPASSWORD in ${ENV_LOCAL_RELATIVE}`]);
    expect(found(OTHER)).toEqual([`the value of MY_API_SECRET in ${ENV_LOCAL_RELATIVE}`]);
    expect(found(THIRD)).toEqual([`the value of SOME_TOKEN in ${ENV_LOCAL_RELATIVE}`]);
    expect(found(SPECIAL)).toEqual([]);
  });

  it('is a no-op when the file does not exist', () => {
    expect(sources(PASSWORD, {}, path.join(dir, 'missing'))).toEqual([]);
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
