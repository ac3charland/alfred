import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { jest } from '@jest/globals';

import { BUILDER_PATH, gitIn } from '../git.ts';
import { named } from './failure.ts';
import { runHook } from './run.ts';
import type { HookDeps } from './run.ts';
import { makeRepo, scrubGitEnv, tempDir } from './test-support.ts';
import type { TempRepo } from './test-support.ts';

const NOW = new Date('2026-10-03T09:12:40.123Z');
const ENV = {
  CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test',
  ALFRED_BASE_URL: 'alfred.example.app',
};
const STATE_DIR = 'alfred-session-ledger';

let tmp: string;
let repo: TempRepo;
let output: string[];
let fetchMock: jest.Mock<typeof fetch>;
let readStdin: jest.Mock<() => Promise<string>>;

beforeAll(() => {
  scrubGitEnv();
  repo = makeRepo(
    [{ [BUILDER_PATH]: 'v1\n' }, { '.claude/skills/implement-spec/SKILL.md': 'skill\n' }],
    'http://local_proxy@127.0.0.1:1234/git/ac3charland/alfred',
  );
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = tempDir('run');
  output = [];
  fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  readStdin = jest.fn<() => Promise<string>>().mockResolvedValue('{}');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return {
    env: ENV,
    fetch: fetchMock,
    readStdin,
    git: gitIn(repo.dir),
    now: () => NOW,
    tmpDir: tmp,
    write: (text) => output.push(text),
    ...overrides,
  };
}

function logLines(): string[] {
  const file = path.join(tmp, STATE_DIR, 'hook.log');
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : [];
}

function postedBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

function transcript(lines: readonly object[]): string {
  const file = path.join(tmp, 'transcript.jsonl');
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'));
  return file;
}

describe('the gate', () => {
  it.each([
    ['a local session (no cse_ id)', { ALFRED_BASE_URL: 'alfred.example.app' }],
    ['a session id of another shape', { ...ENV, CLAUDE_CODE_REMOTE_SESSION_ID: 'session_01Test' }],
    ['a bare cse_ prefix', { ...ENV, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_' }],
    ['a cloud session without ALFRED_BASE_URL', { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test' }],
    ['an empty ALFRED_BASE_URL', { ...ENV, ALFRED_BASE_URL: '  ' }],
  ])('does nothing for %s', async (_name, env) => {
    const git = jest.fn<HookDeps['git']>();
    for (const event of ['session-start', 'stop']) {
      await runHook([event], deps({ env, git }));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readStdin).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
    expect(output).toEqual([]);
    expect(existsSync(path.join(tmp, STATE_DIR))).toBe(false);
  });

  it('ignores an event it does not know', async () => {
    await runHook(['session-end'], deps());
    await runHook([], deps());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('session-start', () => {
  it('posts HEAD, the last builder commit and owner/name, and keeps them in the state file', async () => {
    await runHook(['session-start'], deps());
    const builder = gitIn(repo.dir)(['rev-parse', 'HEAD~1']).stdout.trim();
    const expected = {
      event: 'session-start',
      session_id: 'session_01Test',
      repo: 'ac3charland/alfred',
      base_sha: repo.head,
      builder_sha: builder,
      session_created_at: '2026-10-03T09:12:40.123Z',
      warnings: [],
    };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://alfred.example.app/api/code/sessions/record',
    );
    expect(postedBody()).toEqual(expected);
    expect(readStdin).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(path.join(tmp, STATE_DIR, 'session_01Test.json'), 'utf8')),
    ).toEqual({
      repo: 'ac3charland/alfred',
      base_sha: repo.head,
      builder_sha: builder,
    });
    expect(logLines()).toEqual([]);
    expect(output).toEqual([]);
  });

  it('posts a null builder sha when the history does not reach the builder file', async () => {
    const bare = makeRepo([{ 'README.md': 'x\n' }], 'https://github.com/o/n.git');
    try {
      await runHook(['session-start'], deps({ git: gitIn(bare.dir) }));
      expect(postedBody()).toMatchObject({ repo: 'o/n', base_sha: bare.head, builder_sha: null });
    } finally {
      rmSync(bare.dir, { recursive: true, force: true });
    }
  });

  it('logs and posts nothing when the checkout has no origin to name the repo', async () => {
    const bare = makeRepo([{ 'README.md': 'x\n' }]);
    try {
      await runHook(['session-start'], deps({ git: gitIn(bare.dir) }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logLines()).toEqual([
        '2026-10-03T09:12:40.123Z · session-start · session_01Test · RepoUnresolved',
      ]);
    } finally {
      rmSync(bare.dir, { recursive: true, force: true });
    }
  });
});

describe('the request', () => {
  it('prefixes https:// when the host has no scheme, and leaves a given scheme alone', async () => {
    await runHook(['session-start'], deps());
    await runHook(
      ['session-start'],
      deps({ env: { ...ENV, ALFRED_BASE_URL: 'http://127.0.0.1:9/' } }),
    );
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://alfred.example.app/api/code/sessions/record',
      'http://127.0.0.1:9/api/code/sessions/record',
    ]);
  });

  it('sends Authorization only when LEDGER_API_KEY is set', async () => {
    await runHook(['session-start'], deps());
    await runHook(['session-start'], deps({ env: { ...ENV, LEDGER_API_KEY: 'k-123' } }));
    const headers = fetchMock.mock.calls.map((call) => call[1]?.headers as Record<string, string>);
    expect(headers[0]).toEqual({ 'Content-Type': 'application/json' });
    expect(headers[1]).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer k-123',
    });
  });

  it('limits the request to five seconds and sends it once, with no retry', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await runHook(['session-start'], deps());
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('failures', () => {
  it('logs a refusal by its status: one line with no header and no body', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"secret detail"}', { status: 401 }));
    await runHook(['session-start'], deps({ env: { ...ENV, LEDGER_API_KEY: 'k-123' } }));
    expect(logLines()).toEqual(['2026-10-03T09:12:40.123Z · session-start · session_01Test · 401']);
    expect(readFileSync(path.join(tmp, STATE_DIR, 'hook.log'), 'utf8')).not.toMatch(
      /k-123|secret|Bearer/,
    );
    expect(output).toEqual([]);
  });

  it('logs a network error by its name', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await runHook(['session-start'], deps());
    expect(logLines()).toEqual([
      '2026-10-03T09:12:40.123Z · session-start · session_01Test · TypeError',
    ]);
  });

  it('gives up on a request that never answers, logging a TimeoutError', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(named('TimeoutError'));
          });
        }),
    );
    await runHook(['session-start'], deps({ timeoutMs: 20 }));
    expect(logLines()).toEqual([
      '2026-10-03T09:12:40.123Z · session-start · session_01Test · TimeoutError',
    ]);
    expect(output).toEqual([]);
  });

  it('logs an error thrown while assembling the body, such as malformed stdin', async () => {
    readStdin.mockResolvedValue('not json');
    await runHook(['stop'], deps());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logLines()).toEqual(['2026-10-03T09:12:40.123Z · stop · session_01Test · SyntaxError']);
  });

  it.each([['{}'], ['{"transcript_path":7}'], ['[]'], ['null']])(
    'logs stdin without a transcript path: %s',
    async (stdin) => {
      readStdin.mockResolvedValue(stdin);
      await runHook(['stop'], deps());
      expect(logLines()).toEqual([
        '2026-10-03T09:12:40.123Z · stop · session_01Test · TranscriptPathMissing',
      ]);
    },
  );

  it('logs an unreadable transcript by its errno code', async () => {
    readStdin.mockResolvedValue(
      JSON.stringify({ transcript_path: path.join(tmp, 'missing.jsonl') }),
    );
    await runHook(['stop'], deps());
    expect(logLines()).toEqual(['2026-10-03T09:12:40.123Z · stop · session_01Test · ENOENT']);
  });

  it('appends to the log, one line per failure', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await runHook(['session-start'], deps());
    await runHook(['session-start'], deps());
    expect(logLines()).toHaveLength(2);
  });

  it('survives a log it cannot write', async () => {
    writeFileSync(path.join(tmp, STATE_DIR), 'a file where the directory should be');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runHook(['session-start'], deps())).resolves.toBeUndefined();
    expect(readdirSync(tmp)).toEqual([STATE_DIR]);
  });
});

describe('stop', () => {
  const prompt = {
    type: 'user',
    timestamp: '2026-10-03T09:00:00.000Z',
    message: {
      role: 'user',
      content:
        'ALF-7: go\nRead .claude/skills/implement-spec/SKILL.md and .claude/skills/gone/SKILL.md',
    },
  };
  const reply = {
    type: 'assistant',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      },
    },
  };

  function stdinFor(file: string): void {
    readStdin.mockResolvedValue(JSON.stringify({ transcript_path: file }));
  }

  it('resolves the skills at the start commit recorded in the state file', async () => {
    mkdirSync(path.join(tmp, STATE_DIR));
    const blob = gitIn(repo.dir)([
      'rev-parse',
      `${repo.head}:.claude/skills/implement-spec/SKILL.md`,
    ]).stdout.trim();
    // A state file naming an older commit than HEAD: the skill did not exist there.
    const older = gitIn(repo.dir)(['rev-parse', 'HEAD~1']).stdout.trim();
    writeFileSync(
      path.join(tmp, STATE_DIR, 'session_01Test.json'),
      JSON.stringify({ repo: 'o/n', base_sha: repo.head, builder_sha: null }),
    );
    stdinFor(transcript([prompt, reply]));
    await runHook(['stop'], deps());
    expect(postedBody()).toMatchObject({
      repo: 'o/n',
      ref: 'ALF-7',
      skills: [
        { path: '.claude/skills/implement-spec/SKILL.md', blob_sha: blob },
        { path: '.claude/skills/gone/SKILL.md', blob_sha: null },
      ],
      warnings: [],
    });

    writeFileSync(
      path.join(tmp, STATE_DIR, 'session_01Test.json'),
      JSON.stringify({ repo: 'o/n', base_sha: older, builder_sha: null }),
    );
    fetchMock.mockClear();
    await runHook(['stop'], deps());
    expect(postedBody()['skills']).toEqual([
      { path: '.claude/skills/implement-spec/SKILL.md', blob_sha: null },
      { path: '.claude/skills/gone/SKILL.md', blob_sha: null },
    ]);
  });

  it.each([
    ['is missing', undefined],
    ['is not JSON', 'nope'],
    ['lacks a start commit', JSON.stringify({ repo: 'o/n' })],
  ])(
    'sends no skills and warns start_unrecorded when the state file %s',
    async (_name, content) => {
      if (content !== undefined) {
        mkdirSync(path.join(tmp, STATE_DIR));
        writeFileSync(path.join(tmp, STATE_DIR, 'session_01Test.json'), content);
      }
      stdinFor(transcript([prompt, reply]));
      await runHook(['stop'], deps());
      const body = postedBody();
      expect(body).toMatchObject({
        repo: 'ac3charland/alfred',
        prompt: prompt.message.content,
        ref: 'ALF-7',
        warnings: ['start_unrecorded'],
      });
      expect(body).not.toHaveProperty('skills');
      expect(body).not.toHaveProperty('base_sha');
      expect(body).not.toHaveProperty('builder_sha');
    },
  );

  it('sends no prompt, skills or ref when the transcript has no prompt, and never a cost', async () => {
    stdinFor(transcript([reply]));
    await runHook(['stop'], deps());
    const body = postedBody();
    for (const key of ['prompt', 'skills', 'ref', 'cost_usd', 'base_sha']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toMatchObject({
      session_created_at: null,
      model: 'claude-opus-5-5',
      input_tokens: 1,
      cache_write_tokens: 4,
      subagent_count: 0,
      usage_by_model: {
        main: { 'claude-opus-5-5': { requests: 1, cache_write_5m: 4, cache_write_1h: 0 } },
        subagents: {},
      },
    });
  });

  it('omits the ref when the prompt does not open with one', async () => {
    stdinFor(transcript([{ ...prompt, message: { role: 'user', content: 'fix the login page' } }]));
    await runHook(['stop'], deps());
    expect(postedBody()).toMatchObject({ prompt: 'fix the login page' });
    expect(postedBody()).not.toHaveProperty('ref');
  });

  it('takes the effort from CLAUDE_EFFORT when no entry carries one', async () => {
    stdinFor(transcript([prompt, reply]));
    await runHook(['stop'], deps({ env: { ...ENV, CLAUDE_EFFORT: 'xhigh' } }));
    expect(postedBody()).toMatchObject({ effort_level: 'xhigh' });
    fetchMock.mockClear();
    await runHook(['stop'], deps());
    expect(postedBody()).toMatchObject({ effort_level: null });
  });

  it('counts an unreadable subagents directory as unreadable, and a missing one as none', async () => {
    const file = transcript([prompt, reply]);
    stdinFor(file);
    // `subagents` is a file, so listing it fails with ENOTDIR.
    mkdirSync(path.join(tmp, 'transcript'));
    writeFileSync(path.join(tmp, 'transcript', 'subagents'), 'x');
    await runHook(['stop'], deps());
    expect(postedBody()).toMatchObject({
      subagent_count: 0,
      warnings: ['start_unrecorded', 'subagents_unreadable'],
    });
  });

  it('flags subagent usage a transcript recorded only partly', async () => {
    const file = transcript([prompt, reply]);
    stdinFor(file);
    const subagents = path.join(tmp, 'transcript', 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      path.join(subagents, 'agent-x.jsonl'),
      `${JSON.stringify({ ...reply, isSidechain: true, message: { ...reply.message, stop_reason: null } })}\n`,
    );
    await runHook(['stop'], deps());
    expect(postedBody()).toMatchObject({
      subagent_count: 1,
      warnings: ['start_unrecorded', 'subagent_usage_partial'],
    });
  });

  it('prints the body under --dry-run, without a host or a request', async () => {
    stdinFor(transcript([prompt, reply]));
    const env = { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test' };
    await runHook(['stop', '--dry-run'], deps({ env }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      event: 'stop',
      session_id: 'session_01Test',
    });
  });

  it('prints the session-start body under --dry-run, and still records the state', async () => {
    await runHook(
      ['session-start', '--dry-run'],
      deps({ env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test' } }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      event: 'session-start',
      base_sha: repo.head,
    });
    expect(existsSync(path.join(tmp, STATE_DIR, 'session_01Test.json'))).toBe(true);
  });
});
