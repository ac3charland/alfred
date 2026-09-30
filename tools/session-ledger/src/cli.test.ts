import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { buildFixtureRepo } from './fixture-repo.ts';
import type { FixtureRepo } from './fixture-repo.ts';

// Each case spawns the real CLI — its exit code and output are what the skill acts on.
jest.setTimeout(60_000);

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const fixture = (name: string): string => path.join(FIXTURES, name);

let repo: FixtureRepo;
let scratch: string;

beforeAll(() => {
  repo = buildFixtureRepo(mkdtempSync(path.join(os.tmpdir(), 'ledger-cli-repo-')));
  scratch = mkdtempSync(path.join(os.tmpdir(), 'ledger-cli-out-'));
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

const NODE_ARGS = ['--disable-warning=ExperimentalWarning', CLI];

function ledger(args: readonly string[], env: Record<string, string> = {}): Run {
  const result = spawnSync(process.execPath, [...NODE_ARGS, ...args], {
    encoding: 'utf8',
    cwd: scratch,
    env: { ...process.env, INIT_CWD: scratch, ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The async twin, for a test that serves HTTP from this process while the CLI runs. */
function ledgerAsync(args: readonly string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...NODE_ARGS, ...args], {
      cwd: scratch,
      env: { ...process.env, INIT_CWD: scratch, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function buildArgs(out: string): string[] {
  return [
    'build',
    '--sessions',
    fixture('sessions'),
    '--pulls',
    fixture('pulls.json'),
    '--inputs',
    fixture('inputs.json'),
    '--git-dir',
    repo.dir,
    '--out',
    out,
  ];
}

const lines = (file: string): unknown[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);

describe('build', () => {
  it('emits rows matching the golden file field for field', () => {
    // Regenerate after a deliberate change: build to a scratch path, then copy it over
    // fixtures/golden-rows.ndjson (build itself refuses to write inside the work tree).
    const out = path.join(scratch, 'rows.ndjson');

    const run = ledger(buildArgs(out));

    expect(run.code).toBe(0);
    expect(run.stderr).toContain('built 19 rows');
    expect(run.stderr).toContain('invalid record: batch-2.ndjson:9 (session_17Invalid)');
    expect(lines(out)).toEqual(lines(fixture('golden-rows.ndjson')));
  });

  it('refuses an --out inside a git work tree — ledger data is never committed', () => {
    const run = ledger(buildArgs(path.join(repo.dir, 'rows.ndjson')));

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('inside the git work tree');
  });

  it('refuses an --out inside the work tree it was invoked from', () => {
    const run = ledger(buildArgs(path.join(FIXTURES, 'leak.ndjson')));

    expect(run.code).toBe(2);
  });
});

describe('report', () => {
  it('prints the coverage, lane and warning report over a rows file', () => {
    const run = ledger(['report', fixture('golden-rows.ndjson')]);

    expect(run.code).toBe(0);
    expect(run.stdout).toBe(readFileSync(fixture('golden-report.txt'), 'utf8'));
  });
});

describe('sample', () => {
  it('prints max(5, 5%) distinct session ids from the copies', () => {
    const run = ledger(['sample', '--sessions', fixture('sessions')]);
    const ids = run.stdout.trim().split('\n');

    expect(run.code).toBe(0);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => id.startsWith('session_'))).toBe(true);
  });
});

describe('verify', () => {
  const copies = readFileSync(fixture('sessions/batch-1.ndjson'), 'utf8').split('\n');
  const first = copies[0] ?? '';

  it('exits 0 when the re-fetched sample matches', () => {
    const against = path.join(scratch, 'verify-ok.ndjson');
    writeFileSync(against, `${first}\n`);

    const run = ledger(['verify', '--sessions', fixture('sessions'), '--against', against]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('verified 1 session(s)');
  });

  it('exits 1 on a single differing cost_usd', () => {
    const against = path.join(scratch, 'verify-bad.ndjson');
    const record = JSON.parse(first) as {
      external_metadata: { usage: { cost_usd: number } };
    };
    record.external_metadata.usage.cost_usd += 0.01;
    writeFileSync(against, `${JSON.stringify(record)}\n`);

    const run = ledger(['verify', '--sessions', fixture('sessions'), '--against', against]);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('mismatch: session_01ImplSpec usage');
  });
});

describe('push', () => {
  it('posts the rows to ALFRED_BASE_URL and, with --report, prints the report and push line', async () => {
    const bodies: { rows: unknown[] }[] = [];
    const headers: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        bodies.push(JSON.parse(body) as { rows: unknown[] });
        headers.push(request.headers.authorization);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ upserted: 19, kept_recorded: 1 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const run = await ledgerAsync(['push', fixture('golden-rows.ndjson'), '--report'], {
        ALFRED_BASE_URL: `http://127.0.0.1:${String(port)}`,
        LEDGER_API_KEY: 'test-ledger-key',
      });

      expect(run.code).toBe(0);
      expect(bodies.map((body) => body.rows.length)).toEqual([19]);
      expect(headers).toEqual(['Bearer test-ledger-key']);
      expect(run.stdout).toContain('coverage          rows   pct');
      expect(run.stdout.trim().split('\n').at(-1)).toBe(
        'pushed 19 rows (19 upserted, 1 kept recorded prompts)',
      );
    } finally {
      server.close();
    }
  });

  it('refuses to push without ALFRED_BASE_URL', () => {
    const run = ledger(['push', fixture('golden-rows.ndjson')], { ALFRED_BASE_URL: '' });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('ALFRED_BASE_URL');
  });
});
