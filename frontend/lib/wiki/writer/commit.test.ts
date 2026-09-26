/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  MAX_COMMIT_ATTEMPTS,
  WikiWriteError,
  type WikiWriteErrorKind,
  commitEnvelopes,
  commitMessage,
} from './commit';
import type { WikiConfig } from './config';
import type { Envelope } from './envelope';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));

const TOKEN = 'github_pat_secret';

const CONFIG: WikiConfig = {
  owner: 'ac3charland',
  name: 'knowledge',
  token: TOKEN,
  apiUrl: 'https://api.github.test',
};

const BASE = `${CONFIG.apiUrl}/repos/ac3charland/knowledge`;

function envelope(title: string, files: { name: string; content: string }[]): Envelope {
  return { title, captured: '2026-10-03', files };
}

const HABITS = envelope('Why habits stick', [
  { name: 'source.md', content: 'source' },
  { name: 'picks-2026-10-03.md', content: 'picks' },
]);

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** One scripted answer: matched by method + path suffix, consumed in order per key. */
type Script = Record<string, (() => Response)[]>;

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fetch that answers from a script and records every request. The default script is one
 * clean fast-forward on a repo whose inbox already holds one folder.
 */
function scripted(overrides: Script = {}, inboxNames = ['2026-10-01-older']) {
  const calls: Recorded[] = [];
  const defaults: Script = {
    'GET /git/ref/heads/main': [() => json(200, { object: { sha: 'head1' } })],
    'GET /git/commits/head1': [() => json(200, { tree: { sha: 'tree1' } })],
    'GET /git/trees/tree1': [
      () =>
        json(200, {
          tree: [
            { path: 'README.md', type: 'blob', sha: 'r' },
            { path: 'inbox', type: 'tree', sha: 'inbox1' },
          ],
        }),
    ],
    'GET /git/trees/inbox1': [
      () =>
        json(200, { tree: inboxNames.map((name) => ({ path: name, type: 'tree', sha: name })) }),
    ],
    'POST /git/trees': [() => json(201, { sha: 'newtree' })],
    'POST /git/commits': [() => json(201, { sha: 'newcommit' })],
    'PATCH /git/refs/heads/main': [() => json(200, { object: { sha: 'newcommit' } })],
  };
  const script: Script = { ...defaults, ...overrides };
  const fetchImpl = jest.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, headers, body });
    const key = `${method} ${url.slice(BASE.length)}`;
    const queue = script[key];
    const next = queue?.[0];
    if (next === undefined) throw new Error(`unscripted request ${key}`);
    if ((queue?.length ?? 0) > 1) queue?.shift();
    return Promise.resolve(next());
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe('commitEnvelopes', () => {
  it('fast-forwards main in seven requests: ref, commit, two trees, tree, commit, ref update', async () => {
    const { fetchImpl, calls } = scripted();

    const result = await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl });

    expect(result).toEqual({
      commitSha: 'newcommit',
      folders: ['inbox/2026-10-03-why-habits-stick'],
    });
    expect(calls.map((call) => `${call.method} ${call.url.slice(BASE.length)}`)).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/commits/head1',
      'GET /git/trees/tree1',
      'GET /git/trees/inbox1',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
  });

  it('builds one tree on the base tree with one blob per file, and one commit on the head', () => {
    const { fetchImpl, calls } = scripted();

    return commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl }).then(() => {
      const tree = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
      expect(tree?.body).toEqual({
        base_tree: 'tree1',
        tree: [
          {
            path: 'inbox/2026-10-03-why-habits-stick/source.md',
            mode: '100644',
            type: 'blob',
            content: 'source',
          },
          {
            path: 'inbox/2026-10-03-why-habits-stick/picks-2026-10-03.md',
            mode: '100644',
            type: 'blob',
            content: 'picks',
          },
        ],
      });
      const commit = calls.find(
        (call) => call.method === 'POST' && call.url.endsWith('/git/commits'),
      );
      expect(commit?.body).toEqual({
        message: 'add: Why habits stick',
        tree: 'newtree',
        parents: ['head1'],
      });
      const update = calls.find((call) => call.method === 'PATCH');
      expect(update?.body).toEqual({ sha: 'newcommit', force: false });
    });
  });

  it("sends GitHub's headers on every request, with alfred's own User-Agent", async () => {
    const { fetchImpl, calls } = scripted();

    await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl });

    for (const call of calls) {
      expect(call.headers).toMatchObject({
        Authorization: 'Bearer github_pat_secret',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'alfred-wiki',
      });
    }
    expect(calls.find((call) => call.method === 'POST')?.headers['Content-Type']).toBe(
      'application/json',
    );
  });

  it('retries from the ref read when main moved (a 422 on the ref update), then succeeds', async () => {
    const { fetchImpl, calls } = scripted({
      'GET /git/ref/heads/main': [
        () => json(200, { object: { sha: 'head1' } }),
        () => json(200, { object: { sha: 'head2' } }),
      ],
      'GET /git/commits/head2': [() => json(200, { tree: { sha: 'tree1' } })],
      'PATCH /git/refs/heads/main': [
        () => json(422, { message: 'Update is not a fast forward' }),
        () => json(200, { object: { sha: 'newcommit' } }),
      ],
    });

    const result = await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl });

    expect(result.commitSha).toBe('newcommit');
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
    // The second attempt commits on the NEW head.
    const commits = calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/git/commits'),
    );
    expect(commits.map((call) => (call.body as { parents: string[] }).parents)).toEqual([
      ['head1'],
      ['head2'],
    ]);
  });

  it(`fails as busy after ${String(MAX_COMMIT_ATTEMPTS)} moved-main attempts`, async () => {
    const { fetchImpl, calls } = scripted({
      'PATCH /git/refs/heads/main': [() => json(422, { message: 'not a fast forward' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      name: 'WikiWriteError',
      kind: 'busy',
    });
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(MAX_COMMIT_ATTEMPTS);
  });

  it('fails as unauthorized on a 401, at once and without a retry', async () => {
    const { fetchImpl, calls } = scripted({
      'GET /git/ref/heads/main': [() => json(401, { message: 'Bad credentials' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(calls).toHaveLength(1);
  });

  it('fails as rejected on a 422 from the tree POST — a malformed path is never "busy"', async () => {
    const { fetchImpl } = scripted({
      'POST /git/trees': [() => json(422, { message: 'Invalid tree' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'rejected',
    });
  });

  it('fails as rejected on a 422 from the commit POST — a malformed commit is never "busy"', async () => {
    const { fetchImpl } = scripted({
      'POST /git/commits': [() => json(422, { message: 'Invalid commit' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'rejected',
    });
  });

  it('fails as rejected on a 500 from the ref update, with exactly one PATCH — no retry', async () => {
    const { fetchImpl, calls } = scripted({
      'PATCH /git/refs/heads/main': [() => json(500, { message: 'Internal Server Error' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'rejected',
    });
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('fails as unauthorized on a 403, at once and without a retry', async () => {
    const { fetchImpl, calls } = scripted({
      'GET /git/ref/heads/main': [() => json(403, { message: 'Forbidden' })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(calls).toHaveLength(1);
  });

  it('fails as unreachable when fetch itself throws', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof globalThis.fetch;

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });

  it('fails as unreachable when a 2xx answers with a body that is not JSON', async () => {
    const { fetchImpl } = scripted({
      'GET /git/ref/heads/main': [
        () => new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });

  it('fails as unreachable when a 2xx body errors mid-read, like a connection reset', async () => {
    const { fetchImpl } = scripted({
      'GET /git/ref/heads/main': [
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('terminated'));
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });

  it('fails as rejected when a 2xx answer is missing the field it is read for', async () => {
    const { fetchImpl } = scripted({
      'GET /git/ref/heads/main': [() => json(200, { object: {} })],
    });

    await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'rejected',
    });
  });

  describe('never puts the token in an error, whatever the failure', () => {
    /**
     * The fetch for each failure kind. Where the failure carries text of its own (a thrown fetch
     * error, a GitHub message), it quotes the token, so an error that passed that text through
     * would be caught here.
     */
    const failures: [
      name: string,
      kind: WikiWriteErrorKind,
      fetchFor: () => typeof globalThis.fetch,
    ][] = [
      [
        'a 403 on the ref read',
        'unauthorized',
        () =>
          scripted({
            'GET /git/ref/heads/main': [() => json(403, { message: `Forbidden ${TOKEN}` })],
          }).fetchImpl,
      ],
      [
        'fetch itself throwing',
        'unreachable',
        () => jest.fn(() => Promise.reject(new Error(`ECONNRESET Bearer ${TOKEN}`))),
      ],
      [
        'a 2xx body that cannot be read',
        'unreachable',
        () =>
          scripted({
            'GET /git/ref/heads/main': [
              () =>
                new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.error(new TypeError(`terminated ${TOKEN}`));
                    },
                  }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
            ],
          }).fetchImpl,
      ],
      [
        'a 2xx answer missing its field',
        'rejected',
        () =>
          scripted({
            'GET /git/ref/heads/main': [() => json(200, { object: {}, note: TOKEN })],
          }).fetchImpl,
      ],
      [
        'a 422 on the tree POST',
        'rejected',
        () =>
          scripted({
            'POST /git/trees': [() => json(422, { message: `Invalid tree ${TOKEN}` })],
          }).fetchImpl,
      ],
      [
        'a 422 on the commit POST',
        'rejected',
        () =>
          scripted({
            'POST /git/commits': [() => json(422, { message: `Invalid commit ${TOKEN}` })],
          }).fetchImpl,
      ],
      [
        `${String(MAX_COMMIT_ATTEMPTS)} ref-update 422s in a row`,
        'busy',
        () =>
          scripted({
            'PATCH /git/refs/heads/main': [
              () => json(422, { message: `not a fast forward ${TOKEN}` }),
            ],
          }).fetchImpl,
      ],
    ];

    it.each(failures)(
      '%s fails as %s, with the token in no part of the error',
      async (_name, kind, fetchFor) => {
        const error = await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchFor() }).catch(
          (error_: unknown) => error_,
        );

        expect(error).toBeInstanceOf(WikiWriteError);
        expect(error).toMatchObject({ kind });
        const thrown = error as WikiWriteError;
        expect(thrown.message).not.toContain(TOKEN);
        for (const [key, value] of Object.entries(thrown)) {
          expect([key, String(value)].join(' ')).not.toContain(TOKEN);
        }
        expect(JSON.stringify(thrown)).not.toContain(TOKEN);
      },
    );

    it('still names the status it failed on', async () => {
      const { fetchImpl } = scripted({
        'GET /git/ref/heads/main': [() => json(403, { message: 'Forbidden' })],
      });

      await expect(commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl })).rejects.toThrow('403');
    });
  });

  it('suffixes a folder whose name inbox/ already holds', async () => {
    const { fetchImpl } = scripted({}, ['2026-10-03-why-habits-stick']);

    const result = await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl });

    expect(result.folders).toEqual(['inbox/2026-10-03-why-habits-stick-2']);
  });

  it('gives two envelopes with one slug two folders in the same commit', async () => {
    const { fetchImpl, calls } = scripted();
    const twin = envelope('Why habits stick', [{ name: 'notes-2026-10-03.md', content: 'n' }]);

    const result = await commitEnvelopes(CONFIG, [HABITS, twin], { fetch: fetchImpl });

    expect(result.folders).toEqual([
      'inbox/2026-10-03-why-habits-stick',
      'inbox/2026-10-03-why-habits-stick-2',
    ]);
    const tree = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: { path: string }[] }).tree.map((entry) => entry.path)).toEqual([
      'inbox/2026-10-03-why-habits-stick/source.md',
      'inbox/2026-10-03-why-habits-stick/picks-2026-10-03.md',
      'inbox/2026-10-03-why-habits-stick-2/notes-2026-10-03.md',
    ]);
    const commit = calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/git/commits'),
    );
    expect((commit?.body as { message: string }).message).toBe('add: 2 sources');
  });

  it('treats a repo with no inbox/ folder yet as having no names taken', async () => {
    const { fetchImpl, calls } = scripted({
      'GET /git/trees/tree1': [
        () => json(200, { tree: [{ path: 'README.md', type: 'blob', sha: 'r' }] }),
      ],
    });

    const result = await commitEnvelopes(CONFIG, [HABITS], { fetch: fetchImpl });

    expect(result.folders).toEqual(['inbox/2026-10-03-why-habits-stick']);
    expect(calls).toHaveLength(6);
  });

  it('refuses an empty send rather than committing an empty tree', async () => {
    const { fetchImpl, calls } = scripted();

    await expect(commitEnvelopes(CONFIG, [], { fetch: fetchImpl })).rejects.toMatchObject({
      kind: 'rejected',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('commitMessage', () => {
  it('names the one title, or counts several', () => {
    expect(commitMessage([HABITS])).toBe('add: Why habits stick');
    expect(commitMessage([HABITS, HABITS])).toBe('add: 2 sources');
  });
});
