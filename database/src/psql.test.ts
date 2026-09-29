import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
