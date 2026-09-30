import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { hookEnv, makeRepo, scrubGitEnv, tempDir } from './test-support.ts';
import type { TempRepo } from './test-support.ts';

// Each case spawns the real hook, because its exit code and silence are the whole contract.
jest.setTimeout(60_000);

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('__fixtures__', import.meta.url));
const SESSION_ID = 'session_01FixtureRecorded';
const STATE_DIR = 'alfred-session-ledger';
const SKILL = '.claude/skills/implement-spec/SKILL.md';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function hook(
  args: readonly string[],
  options: { stdin: string; env: Record<string, string>; cwd: string },
): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: options.cwd,
      env: hookEnv(options.env),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.stdin);
  });
}

interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A local stand-in for alfred that answers every request with `status` and keeps what it got. */
async function serve(
  status: number,
): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      received.push({ method: request.method, url: request.url, headers: request.headers, body });
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end('{"error":"do-not-log-this-body"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    received,
  };
}

let repo: TempRepo;
let projects: string;
let transcriptPath: string;
let scratch: string[] = [];

/** A fresh TMPDIR, which is where the hook keeps its state file and log. */
function freshTmp(): string {
  const dir = tempDir('tmp');
  scratch.push(dir);
  return dir;
}

function writeState(tmp: string): void {
  mkdirSync(path.join(tmp, STATE_DIR), { recursive: true });
  writeFileSync(
    path.join(tmp, STATE_DIR, `${SESSION_ID}.json`),
    JSON.stringify({ repo: 'ac3charland/alfred', base_sha: repo.head, builder_sha: null }),
  );
}

function logLines(tmp: string): string[] {
  const file = path.join(tmp, STATE_DIR, 'hook.log');
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : [];
}

const stopInput = (): string => JSON.stringify({ transcript_path: transcriptPath });

function cloudEnv(tmp: string, extra: Record<string, string> = {}): Record<string, string> {
  return { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01FixtureRecorded', TMPDIR: tmp, ...extra };
}

beforeAll(() => {
  scrubGitEnv();
  repo = makeRepo(
    [{ [SKILL]: 'fixture skill\n' }],
    'http://local_proxy@127.0.0.1:1234/git/ac3charland/alfred',
  );
  // The transcript layout a cloud session writes: a main file, and beside it a directory of
  // subagent files, one readable, one that can't be read (a directory stands in for it, since
  // the suite runs as root), and a .meta.json that is not a transcript.
  projects = tempDir('projects');
  transcriptPath = path.join(projects, 'fixture-uuid.jsonl');
  copyFileSync(path.join(FIXTURES, 'transcript/main.jsonl'), transcriptPath);
  const subagents = path.join(projects, 'fixture-uuid', 'subagents');
  mkdirSync(path.join(subagents, 'agent-broken.jsonl'), { recursive: true });
  copyFileSync(
    path.join(FIXTURES, 'transcript/agent-a1b2c3.jsonl'),
    path.join(subagents, 'agent-a1b2c3.jsonl'),
  );
  writeFileSync(path.join(subagents, 'agent-a1b2c3.meta.json'), '{"agentType":"Explore"}');
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(projects, { recursive: true, force: true });
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe('the contract fixture', () => {
  it('stop --dry-run over the fixture transcripts prints exactly the recorded row', async () => {
    const tmp = freshTmp();
    writeState(tmp);
    const run = await hook(['stop', '--dry-run'], {
      stdin: stopInput(),
      env: cloudEnv(tmp),
      cwd: repo.dir,
    });
    const expected: unknown = JSON.parse(
      readFileSync(path.join(FIXTURES, 'recorded-row.json'), 'utf8'),
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(expected);
    expect(logLines(tmp)).toEqual([]);
  });

  it('posts that same row to alfred, with the key when one is set', async () => {
    const tmp = freshTmp();
    writeState(tmp);
    const alfred = await serve(200);
    try {
      const run = await hook(['stop'], {
        stdin: stopInput(),
        env: cloudEnv(tmp, { ALFRED_BASE_URL: alfred.url, LEDGER_API_KEY: 'test-key-not-real' }),
        cwd: repo.dir,
      });
      expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    } finally {
      alfred.server.close();
    }
    const [request] = alfred.received;
    expect(alfred.received).toHaveLength(1);
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/api/code/sessions/record');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers.authorization).toBe('Bearer test-key-not-real');
    expect(JSON.parse(request?.body ?? '')).toEqual(
      JSON.parse(readFileSync(path.join(FIXTURES, 'recorded-row.json'), 'utf8')),
    );
    expect(logLines(tmp)).toEqual([]);
  });

  it('posts no Authorization header without a key', async () => {
    const tmp = freshTmp();
    writeState(tmp);
    const alfred = await serve(200);
    try {
      await hook(['stop'], {
        stdin: stopInput(),
        env: cloudEnv(tmp, { ALFRED_BASE_URL: alfred.url }),
        cwd: repo.dir,
      });
    } finally {
      alfred.server.close();
    }
    expect(alfred.received[0]?.headers.authorization).toBeUndefined();
  });

  it('records the start of a session against the same host', async () => {
    const tmp = freshTmp();
    const alfred = await serve(200);
    try {
      const run = await hook(['session-start'], {
        stdin: '{"hook_event_name":"SessionStart","source":"startup"}',
        env: cloudEnv(tmp, { ALFRED_BASE_URL: alfred.url }),
        cwd: repo.dir,
      });
      expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    } finally {
      alfred.server.close();
    }
    const body = JSON.parse(alfred.received[0]?.body ?? '') as Record<string, unknown>;
    expect(body).toMatchObject({
      event: 'session-start',
      session_id: SESSION_ID,
      repo: 'ac3charland/alfred',
      base_sha: repo.head,
      builder_sha: null,
      warnings: [],
    });
    expect(
      JSON.parse(readFileSync(path.join(tmp, STATE_DIR, `${SESSION_ID}.json`), 'utf8')),
    ).toEqual({
      repo: 'ac3charland/alfred',
      base_sha: repo.head,
      builder_sha: null,
    });
  });
});

describe('the gate', () => {
  it.each([
    ['no cse_ session id', { ALFRED_BASE_URL: 'http://127.0.0.1:9' }],
    ['no ALFRED_BASE_URL', { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01FixtureRecorded' }],
    [
      'an empty ALFRED_BASE_URL',
      { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01FixtureRecorded', ALFRED_BASE_URL: '' },
    ],
  ])('exits 0 and prints nothing with %s, before reading anything', async (_name, env) => {
    const tmp = freshTmp();
    for (const event of ['session-start', 'stop']) {
      // Garbage stdin and a transcript path that doesn't exist: both would fail loudly if read.
      const run = await hook([event], {
        stdin: '{not json',
        env: { ...env, TMPDIR: tmp },
        cwd: repo.dir,
      });
      expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    }
    expect(existsSync(path.join(tmp, STATE_DIR))).toBe(false);
  });
});

describe('the error matrix', () => {
  const LINE = new RegExp(String.raw`^\d{4}-\d\d-\d\dT[\d:.]+Z · stop · ${SESSION_ID} · (\w+)$`);

  async function failure(
    env: Record<string, string>,
    stdin = stopInput(),
  ): Promise<{ run: Run; what: string }> {
    const tmp = freshTmp();
    writeState(tmp);
    const run = await hook(['stop'], { stdin, env: cloudEnv(tmp, env), cwd: repo.dir });
    const lines = logLines(tmp);
    expect(lines).toHaveLength(1);
    const match = LINE.exec(lines[0] ?? '');
    expect(match).not.toBeNull();
    return { run, what: match?.[1] ?? '' };
  }

  it('a thrown error (malformed stdin) exits 0 silently and logs its name', async () => {
    const { run, what } = await failure(
      { ALFRED_BASE_URL: 'http://127.0.0.1:9' },
      'not json at all',
    );
    expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(what).toBe('SyntaxError');
  });

  it('a network error (connection refused) exits 0 silently and logs its name', async () => {
    const closed = await serve(200);
    closed.server.close();
    const { run, what } = await failure({ ALFRED_BASE_URL: closed.url });
    expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(what).toBe('TypeError');
  });

  it('a 401 exits 0 silently and logs the status', async () => {
    const alfred = await serve(401);
    try {
      const { run, what } = await failure({ ALFRED_BASE_URL: alfred.url });
      expect(run).toEqual({ code: 0, stdout: '', stderr: '' });
      expect(what).toBe('401');
    } finally {
      alfred.server.close();
    }
  });

  it('keeps every line of the log free of the key and of the response body', async () => {
    const alfred = await serve(401);
    const tmp = freshTmp();
    writeState(tmp);
    try {
      await hook(['stop'], {
        stdin: stopInput(),
        env: cloudEnv(tmp, { ALFRED_BASE_URL: alfred.url, LEDGER_API_KEY: 'test-key-not-real' }),
        cwd: repo.dir,
      });
    } finally {
      alfred.server.close();
    }
    const log = readFileSync(path.join(tmp, STATE_DIR, 'hook.log'), 'utf8');
    expect(log).not.toMatch(/test-key-not-real|Bearer|do-not-log-this-body/);
  });
});
