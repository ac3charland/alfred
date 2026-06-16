import worker, { type Env } from './index';

const env: Env = {
  GITHUB_WEBHOOK_SECRET: 'webhook-secret',
  GITHUB_TOKEN: 'pat-123',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

type FetchArgs = Parameters<typeof worker.fetch>;

/** HMAC-SHA256 hex of `body` under `secret`, as GitHub's `X-Hub-Signature-256` value. */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256=${hex}`;
}

/** Base64-encode UTF-8 text with Web-standard primitives (no Node Buffer in the Workers runtime). */
function toBase64Utf8(text: string): string {
  const binary = [...new TextEncoder().encode(text)]
    .map((byte) => String.fromCodePoint(byte))
    .join('');
  return btoa(binary);
}

/** Invoke the Worker, collecting any waitUntil background work so tests can await it. */
async function invoke(
  request: Request,
): Promise<{ response: Response; background: Promise<unknown> }> {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
  } as unknown as FetchArgs[2];

  const response = await worker.fetch(request, env, ctx);
  return { response, background: Promise.all(tasks) };
}

/** Build a signed `pull_request` webhook request. */
async function webhookRequest(
  payload: unknown,
  options: { event?: string; secret?: string } = {},
): Promise<Request> {
  const body = JSON.stringify(payload);
  const secret = options.secret ?? env.GITHUB_WEBHOOK_SECRET;
  const signature = await sign(secret, body);
  return new Request('https://worker.dev/github/webhook', {
    method: 'POST',
    headers: {
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': options.event ?? 'pull_request',
      'Content-Type': 'application/json',
    },
    body,
  });
}

function prPayload(overrides: {
  action?: string;
  body?: string;
  merged?: boolean;
  mergeSha?: string;
}): unknown {
  return {
    action: overrides.action ?? 'opened',
    pull_request: {
      body: overrides.body ?? '',
      html_url: 'https://github.com/ac3charland/alfred/pull/5',
      merged: overrides.merged ?? false,
      merge_commit_sha: overrides.mergeSha ?? undefined,
    },
    repository: { full_name: 'ac3charland/alfred' },
  };
}

const alfredBlock = (lines: string[]): string => ['```alfred', ...lines, '```'].join('\n');

describe('worker.fetch', () => {
  it('GET / returns the health response', async () => {
    const { response } = await invoke(new Request('https://worker.dev/'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('alfred workers ok');
  });

  it('404s an unknown route', async () => {
    const { response } = await invoke(new Request('https://worker.dev/nope'));
    expect(response.status).toBe(404);
  });

  it('rejects a webhook with an invalid signature (401)', async () => {
    const request = await webhookRequest(prPayload({}), { secret: 'wrong-secret' });
    const { response } = await invoke(request);
    expect(response.status).toBe(401);
  });

  it('ignores non-pull_request events', async () => {
    const request = await webhookRequest({ zen: 'hi' }, { event: 'ping' });
    const { response } = await invoke(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: 'not a pull_request event' });
  });

  it('ignores a PR with no alfred block', async () => {
    const request = await webhookRequest(prPayload({ body: 'just a normal PR' }));
    const { response } = await invoke(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: 'no alfred frontmatter block' });
  });

  it('advances a ticket when an implementation PR opens', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([{ ref: 'ALF-42' }], { status: 200 }));

    const request = await webhookRequest(
      prPayload({
        action: 'opened',
        body: alfredBlock(['alfred-ticket: ALF-42', 'phase: implementation']),
      }),
    );
    const { response } = await invoke(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tickets: ['ALF-42'],
      state: 'ready_for_review',
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/code_items?ref=eq.ALF-42');
    expect(init.body).toContain('"factory_state":"ready_for_review"');
    expect(init.body).toContain('"implementation_pr_url"');
  });

  it('snapshots the spec when a refinement PR merges', async () => {
    const markdown = '# ALF-42 — Spec\n\nThe body.';
    const contentsBody = JSON.stringify({
      content: toBase64Utf8(markdown),
      encoding: 'base64',
      sha: 'blobsha',
    });
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = input as string;
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(new Response(contentsBody, { status: 200 }));
      }
      return Promise.resolve(Response.json([{ ref: 'ALF-42' }], { status: 200 }));
    });

    const request = await webhookRequest(
      prPayload({
        action: 'closed',
        merged: true,
        mergeSha: 'mergesha123',
        body: alfredBlock([
          'alfred-ticket: ALF-42',
          'phase: refinement',
          'spec-path: docs/specs/ALF-42.md',
        ]),
      }),
    );
    const { response, background } = await invoke(request);
    await background;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tickets: ['ALF-42'],
      state: 'ready_for_dev',
    });

    const calls = spy.mock.calls.map(([input]) => input as string);
    // The state PATCH, the GitHub Contents fetch, and the spec-snapshot PATCH all happened.
    expect(calls).toContain(
      'https://api.github.com/repos/ac3charland/alfred/contents/docs/specs/ALF-42.md?ref=mergesha123',
    );
    const snapshotBodies = spy.mock.calls
      .map(([, init]) => (init as RequestInit | undefined)?.body)
      .filter((body): body is string => typeof body === 'string');
    const snapshotBody = snapshotBodies.find((body) => body.includes('spec_markdown'));
    expect(snapshotBody).toBeDefined();
    expect(snapshotBody).toContain('# ALF-42 — Spec');
  });
});
