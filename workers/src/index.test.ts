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
  fullName?: string;
}): unknown {
  return {
    action: overrides.action ?? 'opened',
    pull_request: {
      body: overrides.body ?? '',
      html_url: 'https://github.com/ac3charland/alfred/pull/5',
      merged: overrides.merged ?? false,
      merge_commit_sha: overrides.mergeSha ?? undefined,
    },
    repository: { full_name: overrides.fullName ?? 'ac3charland/alfred' },
  };
}

const alfredBlock = (lines: string[]): string => ['```alfred', ...lines, '```'].join('\n');

/**
 * Mock `fetch` routing GitHub Contents requests and Supabase PATCHes separately. `matchedRefs`
 * lists the refs Supabase reports as updated (rows returned); any other ref reports zero rows.
 */
function mockRoutedFetch(
  options: { githubStatus?: number; matchedRefs?: string[] } = {},
): jest.SpyInstance {
  const markdown = '# Spec\n\nbody';
  const contentsBody = JSON.stringify({
    content: btoa(markdown),
    encoding: 'base64',
    sha: 'blobsha',
  });
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = input as string;
    if (url.startsWith('https://api.github.com/')) {
      return Promise.resolve(new Response(contentsBody, { status: options.githubStatus ?? 200 }));
    }
    const ref = /ref=eq\.([^&]+)/.exec(url)?.[1] ?? '';
    const matched = options.matchedRefs ?? [ref];
    const rows = matched.includes(ref) ? [{ ref }] : [];
    return Promise.resolve(Response.json(rows, { status: 200 }));
  });
}

/** The GitHub Contents API URLs the Worker fetched (the spec-snapshot calls). */
function githubCalls(spy: jest.SpyInstance): string[] {
  return spy.mock.calls
    .map(([input]) => input as string)
    .filter((url) => url.startsWith('https://api.github.com/'));
}

describe('worker.fetch', () => {
  it('GET / returns the health response', async () => {
    const { response } = await invoke(new Request('https://worker.dev/'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('alfred workers ok');
  });

  it('404s an unknown route', async () => {
    const { response } = await invoke(new Request('https://worker.dev/nope'));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('not found');
  });

  it('rejects a webhook with an invalid signature (401)', async () => {
    const request = await webhookRequest(prPayload({}), { secret: 'wrong-secret' });
    const { response } = await invoke(request);
    expect(response.status).toBe(401);
    // Assert the JSON body and Content-Type so the response shape can't be emptied unnoticed.
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'invalid signature' });
  });

  it('404s a non-GET request to the health path', async () => {
    // The method check on the health route must hold: a POST to '/' is not a health check.
    const { response } = await invoke(new Request('https://worker.dev/', { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('not found');
  });

  it('404s a GET to the webhook path (method must be POST)', async () => {
    const { response } = await invoke(
      new Request('https://worker.dev/github/webhook', { method: 'GET' }),
    );
    expect(response.status).toBe(404);
  });

  it('404s a POST to an unknown path (pathname must match the webhook route)', async () => {
    const { response } = await invoke(
      new Request('https://worker.dev/elsewhere', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });

  it('400s a webhook whose body is not valid JSON', async () => {
    const body = 'not json{';
    const signature = await sign(env.GITHUB_WEBHOOK_SECRET, body);
    const request = new Request('https://worker.dev/github/webhook', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': signature, 'X-GitHub-Event': 'pull_request' },
      body,
    });
    const { response } = await invoke(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid JSON' });
  });

  it('ignores a no-op action (neither opened nor closed) as a benign 200', async () => {
    const request = await webhookRequest(
      prPayload({
        action: 'synchronize',
        body: alfredBlock(['alfred-ticket: ALF-42', 'phase: implementation']),
      }),
    );
    const { response } = await invoke(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: "no-op for action 'synchronize'" });
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

  it('reports only the tickets whose row actually matched (count > 0)', async () => {
    // Two tickets; Supabase matches ALF-1 but not ALF-2 (a ref we do not track). The response
    // must list only the matched ref — the `filter(count > 0)` is what does that.
    mockRoutedFetch({ matchedRefs: ['ALF-1'] });
    const request = await webhookRequest(
      prPayload({
        action: 'opened',
        body: alfredBlock(['alfred-ticket: ALF-1, ALF-2', 'phase: implementation']),
      }),
    );
    const { response } = await invoke(request);
    expect(await response.json()).toMatchObject({ tickets: ['ALF-1'] });
  });

  it('does not snapshot when the transition is not a refinement merge (snapshotSpec false)', async () => {
    // Refinement PR *opened* (snapshotSpec false), but with a spec-path and a merge sha present so
    // the only thing stopping a snapshot is the guard's first clause.
    const spy = mockRoutedFetch();
    const request = await webhookRequest(
      prPayload({
        action: 'opened',
        mergeSha: 'sha123',
        body: alfredBlock([
          'alfred-ticket: ALF-42',
          'phase: refinement',
          'spec-path: docs/specs/ALF-42.md',
        ]),
      }),
    );
    const { background } = await invoke(request);
    await background;
    expect(githubCalls(spy)).toHaveLength(0);
  });

  it('does not snapshot a refinement merge that carries no spec-path', async () => {
    const spy = mockRoutedFetch();
    const request = await webhookRequest(
      prPayload({
        action: 'closed',
        merged: true,
        mergeSha: 'sha123',
        body: alfredBlock(['alfred-ticket: ALF-42', 'phase: refinement']),
      }),
    );
    const { background } = await invoke(request);
    await background;
    expect(githubCalls(spy)).toHaveLength(0);
  });

  it('does not snapshot when no ticket row matched (nothing to attach the spec to)', async () => {
    const spy = mockRoutedFetch({ matchedRefs: [] });
    const request = await webhookRequest(
      prPayload({
        action: 'closed',
        merged: true,
        mergeSha: 'sha123',
        body: alfredBlock([
          'alfred-ticket: ALF-42',
          'phase: refinement',
          'spec-path: docs/specs/ALF-42.md',
        ]),
      }),
    );
    const { background } = await invoke(request);
    await background;
    expect(githubCalls(spy)).toHaveLength(0);
  });

  it('does not fetch the spec when owner/name/sha cannot be derived', async () => {
    // Refinement merge that would snapshot, but repository.full_name has no slash → name is
    // undefined, so the snapshot must bail before fetching GitHub.
    const spy = mockRoutedFetch();
    const request = await webhookRequest(
      prPayload({
        action: 'closed',
        merged: true,
        mergeSha: 'sha123',
        fullName: 'noslash',
        body: alfredBlock([
          'alfred-ticket: ALF-42',
          'phase: refinement',
          'spec-path: docs/specs/ALF-42.md',
        ]),
      }),
    );
    const { background } = await invoke(request);
    await background;
    expect(githubCalls(spy)).toHaveLength(0);
  });

  it('writes no spec snapshot when the GitHub fetch fails (best-effort)', async () => {
    const spy = mockRoutedFetch({ githubStatus: 404 });
    const request = await webhookRequest(
      prPayload({
        action: 'closed',
        merged: true,
        mergeSha: 'sha123',
        body: alfredBlock([
          'alfred-ticket: ALF-42',
          'phase: refinement',
          'spec-path: docs/specs/ALF-42.md',
        ]),
      }),
    );
    const { background } = await invoke(request);
    // The background work must resolve (not throw on the undefined spec) and write no snapshot.
    await background;
    expect(githubCalls(spy)).toHaveLength(1);
    const patchedSpec = spy.mock.calls
      .map(([, init]) => (init as RequestInit | undefined)?.body)
      .filter((body): body is string => typeof body === 'string')
      .some((body) => body.includes('spec_markdown'));
    expect(patchedSpec).toBe(false);
  });
});
