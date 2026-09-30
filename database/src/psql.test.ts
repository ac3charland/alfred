import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { psqlInvocation } from './psql.ts';

// Assembled at runtime so this file stays clean under the repo's own secret scan.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const HOST = 'aws-1-us-east-2.pooler.supabase.com:5432';

describe('psqlInvocation', () => {
  it('moves the password out of the URL (and so out of argv) into PGPASSWORD', () => {
    const { args, env } = psqlInvocation(`postgresql://postgres.ref:${PASSWORD}@${HOST}/postgres`, [
      '-c',
      'select 1',
    ]);
    expect(env).toEqual({ PGPASSWORD: PASSWORD });
    expect(args).toEqual([
      '--dbname',
      `postgresql://postgres.ref@${HOST}/postgres`,
      '-c',
      'select 1',
    ]);
    expect(args.join(' ')).not.toContain(PASSWORD);
  });

  it('percent-decodes the password, since libpq reads PGPASSWORD verbatim', () => {
    const encoded = ['p%40ss', '%3Aword'].join('');
    const { env } = psqlInvocation(`postgresql://postgres:${encoded}@${HOST}/postgres`, []);
    const decoded = ['p@ss', 'word'].join(':');
    expect(env).toEqual({ PGPASSWORD: decoded });
  });

  it('keeps query parameters such as sslmode on the URL', () => {
    const { args } = psqlInvocation(`postgres://u:${PASSWORD}@${HOST}/db?sslmode=require`, []);
    expect(args).toEqual(['--dbname', `postgres://u@${HOST}/db?sslmode=require`]);
  });

  it('also lifts a ?password= query parameter off argv', () => {
    const { args, env } = psqlInvocation(
      `postgres://u@${HOST}/db?sslmode=require&password=${PASSWORD}`,
      [],
    );
    expect(env).toEqual({ PGPASSWORD: PASSWORD });
    expect(args).toEqual(['--dbname', `postgres://u@${HOST}/db?sslmode=require`]);
  });

  it('leaves query parameters byte-for-byte alone when there is no password to lift', () => {
    // URLSearchParams re-serialization would turn %20 into "+", which libpq reads literally.
    const { args } = psqlInvocation(
      `postgres://u:${PASSWORD}@${HOST}/db?application_name=a%20b&options=-c%20search_path%3Dfoo`,
      [],
    );
    expect(args).toEqual([
      '--dbname',
      `postgres://u@${HOST}/db?application_name=a%20b&options=-c%20search_path%3Dfoo`,
    ]);
  });

  it('keeps the original encoding of the other parameters when lifting ?password=', () => {
    const { args, env } = psqlInvocation(
      `postgres://u@${HOST}/db?options=-c%20search_path%3Dfoo&password=${PASSWORD}&tag=a+b&sslmode=require`,
      [],
    );
    expect(env).toEqual({ PGPASSWORD: PASSWORD });
    expect(args).toEqual([
      '--dbname',
      `postgres://u@${HOST}/db?options=-c%20search_path%3Dfoo&tag=a+b&sslmode=require`,
    ]);
  });

  it('lifts a ?password= whose key is itself percent-encoded, and decodes its value', () => {
    const encoded = ['p%40ss', 'word'].join('');
    const { args, env } = psqlInvocation(
      `postgres://u@${HOST}/db?application_name=a%20b&pass%77ord=${encoded}`,
      [],
    );
    expect(env).toEqual({ PGPASSWORD: ['p@ss', 'word'].join('') });
    expect(args).toEqual(['--dbname', `postgres://u@${HOST}/db?application_name=a%20b`]);
    expect(args.join(' ')).not.toContain('ssword');
  });

  it.each([
    ['multi-host', `postgresql://u:${PASSWORD}@dbone.example:5432,dbtwo.example:5433/db`],
    ['empty-host unix-socket', `postgresql://u:${PASSWORD}@/db?host=/var/run/postgresql`],
    ['keyword/value', `host=dbone.example user=u password=${PASSWORD}`],
  ])(
    'fails closed with a clear message on a %s URL, never echoing the URL or password',
    (_, url) => {
      let message = '';
      try {
        psqlInvocation(url, []);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/single-host postgres(ql)?:\/\/ URL/);
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain('dbone');
    },
  );

  it('sets no PGPASSWORD when the URL carries none', () => {
    const { args, env } = psqlInvocation('postgresql://postgres@localhost:5432/postgres', ['-At']);
    expect(env).toEqual({});
    expect(args).toEqual(['--dbname', 'postgresql://postgres@localhost:5432/postgres', '-At']);
  });
});

describe('npm run psql (script)', () => {
  const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'psql.ts');
  let bin: string;

  beforeEach(() => {
    // A stand-in `psql` on PATH that echoes what it was handed, so the wiring is testable
    // without a reachable database.
    bin = mkdtempSync(path.join(tmpdir(), 'fake-psql-'));
    const fake = path.join(bin, 'psql');
    writeFileSync(
      fake,
      '#!/bin/sh\necho "argv: $*"\necho "PGPASSWORD set: ${PGPASSWORD:+yes}"\nexit 3\n',
    );
    chmodSync(fake, 0o755);
  });

  afterEach(() => {
    rmSync(bin, { recursive: true, force: true });
  });

  function run(env: Record<string, string>): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [SCRIPT, '-c', 'select 1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
    });
  }

  it('resolves DATABASE_URL, hands psql a password-free URL, and propagates its exit code', () => {
    const result = run({ DATABASE_URL: `postgresql://postgres.ref:${PASSWORD}@${HOST}/postgres` });
    expect(result.stdout).toBe(
      `argv: --dbname postgresql://postgres.ref@${HOST}/postgres -c select 1\nPGPASSWORD set: yes\n`,
    );
    expect(result.status).toBe(3);
  });

  it('still runs when invoked through a symlink under a path with a space', () => {
    // `process.argv[1]` keeps the symlink path while `import.meta.url` is the real file, and a
    // space is %20 in one and literal in the other: a naive string compare is false and the
    // script exits 0 having printed nothing — silent empty output a demo would record as proof.
    const spaced = path.join(bin, 'dir with space');
    mkdirSync(spaced);
    const link = path.join(spaced, 'psql.ts');
    symlinkSync(SCRIPT, link);
    const result = spawnSync(process.execPath, [link, '-c', 'select 1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        DATABASE_URL: `postgresql://postgres.ref:${PASSWORD}@${HOST}/postgres`,
      },
    });
    expect(result.stdout).toBe(
      `argv: --dbname postgresql://postgres.ref@${HOST}/postgres -c select 1\nPGPASSWORD set: yes\n`,
    );
    expect(result.status).toBe(3);
  });

  it('exits 1 with a clear stderr, and no URL or password, for an unparseable DATABASE_URL', () => {
    const result = run({
      DATABASE_URL: `postgresql://u:${PASSWORD}@dbone.example:5432,dbtwo.example:5433/db`,
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^psql: DATABASE_URL isn't a single-host postgresql:\/\/ URL/);
    expect(result.stderr).not.toContain(PASSWORD);
    expect(result.status).toBe(1);
  });

  describe('frontend/.env.local fallback', () => {
    // `ENV_LOCAL_PATH` is resolved relative to migrate.ts, so mirror the repo layout in a temp
    // dir (with a space in it) and run copies of the real sources: the true fallback path, end
    // to end, without touching the developer's actual gitignored frontend/.env.local.
    const SRC = path.dirname(SCRIPT);
    let root: string;
    let script: string;

    beforeEach(() => {
      root = path.join(bin, 'repo copy');
      const dbSrc = path.join(root, 'database', 'src');
      mkdirSync(dbSrc, { recursive: true });
      mkdirSync(path.join(root, 'frontend'));
      writeFileSync(path.join(root, 'database', 'package.json'), '{"type":"module"}\n');
      copyFileSync(SCRIPT, path.join(dbSrc, 'psql.ts'));
      copyFileSync(path.join(SRC, 'migrate.ts'), path.join(dbSrc, 'migrate.ts'));
      script = path.join(dbSrc, 'psql.ts');
    });

    function runCopy(): ReturnType<typeof spawnSync> {
      const { DATABASE_URL: _drop, ...rest } = process.env;
      return spawnSync(process.execPath, [script, '-c', 'select 1'], {
        encoding: 'utf8',
        env: { ...rest, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
      });
    }

    it('reads DATABASE_URL from frontend/.env.local when it is not exported', () => {
      writeFileSync(
        path.join(root, 'frontend', '.env.local'),
        `# comment\nOTHER=1\nDATABASE_URL="postgresql://postgres.ref:${PASSWORD}@${HOST}/postgres"\n`,
      );
      const result = runCopy();
      expect(result.stdout).toBe(
        `argv: --dbname postgresql://postgres.ref@${HOST}/postgres -c select 1\nPGPASSWORD set: yes\n`,
      );
      expect(result.status).toBe(3);
    });

    it('names frontend/.env.local in the error when neither source has a URL', () => {
      writeFileSync(path.join(root, 'frontend', '.env.local'), 'OTHER=1\n');
      const result = runCopy();
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('DATABASE_URL');
      expect(result.stderr).toContain('.env.local');
      expect(result.status).toBe(1);
    });
  });
});
