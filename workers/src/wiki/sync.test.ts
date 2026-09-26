import { spyOnFetch } from '../fetch-stub';
import type { WikiFetch } from './graphql';
import { WIKI_SYNC_PAGE_CAP, WIKI_SYNC_SUBREQUEST_CEILING, syncWiki } from './sync';

const env = {
  GITHUB_TOKEN: 'pat-123',
  WIKI_REPO: 'ac3charland/knowledge',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-10-02T09:17:00.000Z');

/** A JSON null for fixtures and matchers — the package bans the literal (unicorn/no-null). */
const WIRE_NULL: unknown = JSON.parse('null');
const COMMIT = 'c'.repeat(40);

/** A distinct 40-hex blob oid per number. */
const oid = (n: number): string => n.toString(16).padStart(40, '0');

/** A page whose text links one entity, so the parse is visible in the row. */
const pageText = (title: string): string =>
  `---\ntitle: ${title}\nupdated: 2026-10-01\n---\nSee [JC](../entities/james-clear.md).\n`;

interface Blob {
  text?: string;
  isBinary?: boolean;
  isTruncated?: boolean;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  prefer: string | undefined;
}

/** The GraphQL #1 `data.repository` for a path → oid map, grouped into the four sections. */
function treeRepository(tree: Record<string, string>): Record<string, unknown> {
  const sections: Record<string, { entries: { name: string; type: string; oid: string }[] }> = {
    concepts: { entries: [] },
    entities: { entries: [] },
    sources: { entries: [] },
    questions: { entries: [] },
  };
  for (const [path, blobOid] of Object.entries(tree)) {
    const [, section = '', name = ''] = path.split('/');
    sections[section]?.entries.push({ name, type: 'blob', oid: blobOid });
  }
  return { ref: { target: { oid: COMMIT } }, ...sections };
}

/**
 * A routed stand-in for GitHub and Supabase that records every subrequest. `tree` is the repo;
 * `stored` the table; `blobs` each oid's content (default: a page titled by its oid).
 */
function backend(options: {
  tree?: Record<string, string>;
  treeBody?: string;
  stored?: Record<string, string>;
  blobs?: Record<string, Blob>;
  /** A verbatim GraphQL #2 response, in place of the one built from `blobs`. */
  blobsBody?: string;
  failOn?: (call: Call) => boolean;
}) {
  const calls: Call[] = [];
  const fetch = jest.fn<ReturnType<WikiFetch>, Parameters<WikiFetch>>((url, init) => {
    const headers = init.headers as Record<string, string>;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { url, method: init.method ?? 'GET', body, prefer: headers['Prefer'] };
    calls.push(call);
    if (options.failOn?.(call) === true) {
      return Promise.resolve(new Response('upstream broke', { status: 500 }));
    }

    if (url === 'https://api.github.com/graphql') {
      const { query } = body as { query: string };
      if (query.includes('refs/heads/main')) {
        return Promise.resolve(
          new Response(
            options.treeBody ??
              JSON.stringify({ data: { repository: treeRepository(options.tree ?? {}) } }),
          ),
        );
      }
      if (options.blobsBody !== undefined) return Promise.resolve(new Response(options.blobsBody));
      const repository: Record<string, unknown> = {};
      for (const [, alias = '', blobOid = ''] of query.matchAll(
        /(p\d+): object\(oid: "(\w+)"\)/g,
      )) {
        const blob = options.blobs?.[blobOid] ?? { text: pageText(`Page ${blobOid.slice(-3)}`) };
        repository[alias] = {
          text: blob.text ?? WIRE_NULL,
          isBinary: blob.isBinary ?? false,
          isTruncated: blob.isTruncated ?? false,
        };
      }
      return Promise.resolve(Response.json({ data: { repository } }));
    }

    if (call.method === 'GET') {
      const rows = Object.entries(options.stored ?? {}).map(([path, blob_oid]) => ({
        path,
        blob_oid,
      }));
      return Promise.resolve(Response.json(rows));
    }
    return Promise.resolve(new Response(undefined, { status: 201 }));
  });

  const find = (predicate: (call: Call) => boolean): Call[] =>
    calls.filter((call) => predicate(call));
  return {
    fetch,
    calls,
    upserts: () => find((c) => c.method === 'POST' && c.url.includes('/rest/v1/wiki_pages')),
    deletes: () => find((c) => c.method === 'DELETE'),
    stateWrites: () => find((c) => c.url.includes('/rest/v1/wiki_sync')),
    blobQueries: () =>
      find(
        (c) => c.url.includes('graphql') && (c.body as { query: string }).query.includes('Blob'),
      ),
  };
}

/** Every row a run upserted, in the one request's order. */
function upsertedRows(api: ReturnType<typeof backend>): Record<string, unknown>[] {
  const [upsert] = api.upserts();
  return (upsert?.body ?? []) as Record<string, unknown>[];
}

/** The `path=in.(…)` filter of the run's one delete, or undefined when it deleted nothing. */
function deletedPaths(api: ReturnType<typeof backend>): string | undefined {
  const [call] = api.deletes();
  return call === undefined ? undefined : (new URL(call.url).searchParams.get('path') ?? undefined);
}

/** A failure recorded once in wiki_sync, with no page written or deleted. */
function expectRecordedFailure(api: ReturnType<typeof backend>, message: string): void {
  expect(api.upserts()).toEqual([]);
  expect(api.deletes()).toEqual([]);
  expect(api.stateWrites()).toHaveLength(1);
  expect(api.stateWrites()[0]?.body).toEqual({
    id: 1,
    last_error: expect.stringContaining(message) as unknown,
    last_error_at: NOW.toISOString(),
  });
}

describe('syncWiki', () => {
  it('first sync: reads the tree, fetches every page, upserts them all and records the commit', async () => {
    const api = backend({
      tree: {
        'wiki/concepts/habit-stacking.md': oid(1),
        'wiki/entities/james-clear.md': oid(2),
      },
    });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toEqual({ ok: true, commitOid: COMMIT, changed: 2, removed: 0, pending: 0 });
    // The select, GraphQL #1, GraphQL #2, the upsert, the state write. Nothing to delete. The
    // select goes FIRST: two overlapping runs then can't diff an older tree against rows a newer
    // run already wrote, which would re-upsert the older pages over them.
    expect(api.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /rest/v1/wiki_pages',
      'POST /graphql',
      'POST /graphql',
      'POST /rest/v1/wiki_pages',
      'POST /rest/v1/wiki_sync',
    ]);

    const rows = upsertedRows(api);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      path: 'wiki/concepts/habit-stacking.md',
      section: 'concepts',
      title: 'Page 001',
      summary: '',
      tags: [],
      sources: [],
      links: ['wiki/entities/james-clear.md'],
      created: WIRE_NULL,
      updated: '2026-10-01',
      body: 'See [JC](../entities/james-clear.md).\n',
      parse_error: WIRE_NULL,
      blob_oid: oid(1),
      commit_oid: COMMIT,
      synced_at: NOW.toISOString(),
    });
    // One shape for every row, or PostgREST refuses the whole batch (PGRST102).
    expect(Object.keys(rows[1] ?? {})).toEqual(Object.keys(rows[0] ?? {}));

    const [upsert] = api.upserts();
    expect(upsert?.url).toBe('https://proj.supabase.co/rest/v1/wiki_pages?on_conflict=path');
    expect(upsert?.prefer).toBe('resolution=merge-duplicates,return=minimal');

    const [state] = api.stateWrites();
    expect(state?.url).toBe('https://proj.supabase.co/rest/v1/wiki_sync?on_conflict=id');
    expect(state?.prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(state?.body).toEqual({
      id: 1,
      commit_oid: COMMIT,
      synced_at: NOW.toISOString(),
      pending: 0,
      last_error: WIRE_NULL,
    });
  });

  it('asks GraphQL #1 for main and the four sections, with the wiki repo and the GitHub headers', async () => {
    const api = backend({});

    await syncWiki(env, { fetch: api.fetch, now: NOW });

    const [, first] = api.fetch.mock.calls;
    const init = first?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer pat-123',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'alfred-software-factory',
    });
    const { query, variables } = api.calls[1]?.body as {
      query: string;
      variables: Record<string, string>;
    };
    expect(variables).toEqual({ owner: 'ac3charland', name: 'knowledge' });
    expect(query).toContain('ref(qualifiedName: "refs/heads/main") { target { oid } }');
    for (const section of ['concepts', 'entities', 'sources', 'questions']) {
      expect(query).toContain(`${section}: object(expression: "main:wiki/${section}")`);
    }
  });

  it('no change: exactly three subrequests — the select, GraphQL #1, the state write', async () => {
    const tree = { 'wiki/concepts/a.md': oid(1), 'wiki/sources/b.md': oid(2) };
    const api = backend({ tree, stored: tree });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toEqual({ ok: true, commitOid: COMMIT, changed: 0, removed: 0, pending: 0 });
    expect(api.calls).toHaveLength(3);
    expect(api.blobQueries()).toEqual([]);
    expect(api.upserts()).toEqual([]);
    expect(api.deletes()).toEqual([]);
    expect(api.stateWrites()).toHaveLength(1);
  });

  it('an edit: re-fetches only the page whose blob oid moved, by that oid', async () => {
    const api = backend({
      tree: { 'wiki/concepts/a.md': oid(9), 'wiki/concepts/b.md': oid(2) },
      stored: { 'wiki/concepts/a.md': oid(1), 'wiki/concepts/b.md': oid(2) },
      blobs: { [oid(9)]: { text: '---\ntitle: A, edited\n---\nnew body\n' } },
    });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toMatchObject({ ok: true, changed: 1, removed: 0, pending: 0 });
    const [blobs] = api.blobQueries();
    expect((blobs?.body as { query: string }).query).toContain(
      `p0: object(oid: "${oid(9)}") { ... on Blob { text isBinary isTruncated } }`,
    );
    expect(upsertedRows(api)).toEqual([
      expect.objectContaining({
        path: 'wiki/concepts/a.md',
        title: 'A, edited',
        body: 'new body\n',
        blob_oid: oid(9),
      }),
    ]);
    expect(api.deletes()).toEqual([]);
  });

  it('a rename: inserts the new path and deletes the old one, each in one request', async () => {
    const api = backend({
      tree: { 'wiki/concepts/new-name.md': oid(1), 'wiki/concepts/kept.md': oid(2) },
      stored: { 'wiki/concepts/old-name.md': oid(1), 'wiki/concepts/kept.md': oid(2) },
    });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toMatchObject({ ok: true, changed: 1, removed: 1, pending: 0 });
    expect(upsertedRows(api).map((row) => row['path'])).toEqual(['wiki/concepts/new-name.md']);
    expect(api.deletes()).toHaveLength(1);
    expect(deletedPaths(api)).toBe('in.("wiki/concepts/old-name.md")');
    expect(api.deletes()[0]?.prefer).toBe('return=minimal');
    // Six: the most any run spends.
    expect(api.calls).toHaveLength(WIKI_SYNC_SUBREQUEST_CEILING);
  });

  it('deletes every removed path in ONE request, each value double-quoted', async () => {
    const api = backend({
      tree: {},
      stored: { 'wiki/concepts/a,b.md': oid(1), 'wiki/concepts/say "hi".md': oid(2) },
    });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toMatchObject({ ok: true, changed: 0, removed: 2 });
    expect(api.deletes()).toHaveLength(1);
    expect(deletedPaths(api)).toBe(
      String.raw`in.("wiki/concepts/a,b.md","wiki/concepts/say \"hi\".md")`,
    );
    expect(api.upserts()).toEqual([]);
  });

  it(`61 changed: takes the first ${String(WIKI_SYNC_PAGE_CAP)} by path and leaves 1 pending`, async () => {
    const tree: Record<string, string> = {};
    for (let index = 0; index < 61; index += 1) {
      tree[`wiki/concepts/page-${String(index).padStart(2, '0')}.md`] = oid(index + 1);
    }
    const api = backend({ tree });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(WIKI_SYNC_PAGE_CAP).toBe(60);
    expect(summary).toEqual({ ok: true, commitOid: COMMIT, changed: 60, removed: 0, pending: 1 });
    const paths = upsertedRows(api).map((row) => row['path']);
    expect(paths).toHaveLength(60);
    expect(paths[0]).toBe('wiki/concepts/page-00.md');
    expect(paths).not.toContain('wiki/concepts/page-60.md');
    // Still one GraphQL #2 and one upsert, however many pages.
    expect(api.blobQueries()).toHaveLength(1);
    expect(api.upserts()).toHaveLength(1);
    expect(api.stateWrites()[0]?.body).toMatchObject({ pending: 1 });
  });

  it(`61 removed: deletes the first ${String(WIKI_SYNC_PAGE_CAP)} by path and leaves 1 pending`, async () => {
    // A restructure can remove hundreds of pages; one DELETE naming them all would outgrow the
    // URL limit (~16KB), so removals are capped like changes and converge the same way.
    const stored: Record<string, string> = {};
    for (let index = 60; index >= 0; index -= 1) {
      stored[`wiki/entities/gone-${String(index).padStart(2, '0')}.md`] = oid(index + 1);
    }
    const api = backend({ tree: {}, stored });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toEqual({ ok: true, commitOid: COMMIT, changed: 0, removed: 60, pending: 1 });
    const filter = deletedPaths(api) ?? '';
    expect(filter.split(',')).toHaveLength(60);
    expect(filter).toContain('"wiki/entities/gone-00.md"');
    expect(filter).not.toContain('gone-60');
    expect(api.stateWrites()[0]?.body).toMatchObject({ pending: 1 });
  });

  it('counts the changes and the removals left over into one pending total', async () => {
    const tree: Record<string, string> = {};
    const stored: Record<string, string> = {};
    for (let index = 0; index < 62; index += 1) {
      tree[`wiki/concepts/new-${String(index).padStart(2, '0')}.md`] = oid(index + 1);
      stored[`wiki/sources/old-${String(index).padStart(2, '0')}.md`] = oid(index + 500);
    }
    const api = backend({ tree, stored });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toEqual({ ok: true, commitOid: COMMIT, changed: 60, removed: 60, pending: 4 });
  });

  it('reads the stored pages in path order', async () => {
    const api = backend({});

    await syncWiki(env, { fetch: api.fetch, now: NOW });

    const [select] = api.calls;
    expect(select?.method).toBe('GET');
    expect(Object.fromEntries(new URL(select?.url ?? '').searchParams)).toEqual({
      select: 'path,blob_oid',
      order: 'path.asc',
    });
  });

  it('sorts the changed paths before capping, whatever order the tree lists them in', async () => {
    const tree: Record<string, string> = {};
    for (let index = 60; index >= 0; index -= 1) {
      tree[`wiki/sources/s-${String(index).padStart(2, '0')}.md`] = oid(index + 100);
    }
    tree['wiki/concepts/z.md'] = oid(1);
    const api = backend({ tree });

    await syncWiki(env, { fetch: api.fetch, now: NOW });

    const paths = upsertedRows(api).map((row) => row['path']);
    expect(paths[0]).toBe('wiki/concepts/z.md');
    expect(paths.at(-1)).toBe('wiki/sources/s-58.md');
  });

  it.each([
    ['binary', { isBinary: true }, 'binary blob'],
    ['truncated', { text: '---\ntitle: Huge\n---\n…', isTruncated: true }, 'truncated blob'],
  ])('stores a %s blob with parse_error set and an empty body', async (_label, blob, reason) => {
    const api = backend({ tree: { 'wiki/sources/figure.md': oid(5) }, blobs: { [oid(5)]: blob } });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toMatchObject({ ok: true, changed: 1 });
    expect(upsertedRows(api)).toEqual([
      expect.objectContaining({
        path: 'wiki/sources/figure.md',
        title: 'figure',
        body: '',
        links: [],
        parse_error: expect.stringContaining(reason) as unknown,
        blob_oid: oid(5),
      }),
    ]);
  });

  it('keeps only markdown blobs directly in a section — no sub-folders, no other files', async () => {
    const repository = treeRepository({});
    repository['concepts'] = {
      entries: [
        { name: 'a.md', type: 'blob', oid: oid(1) },
        { name: 'figure.png', type: 'blob', oid: oid(2) },
        { name: 'drafts.md', type: 'tree', oid: oid(3) },
        { name: 'b.md', type: 'commit', oid: oid(4) },
        { name: '.md', type: 'blob', oid: oid(5) },
      ],
    };
    const api = backend({ treeBody: JSON.stringify({ data: { repository } }) });

    await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(upsertedRows(api).map((row) => row['path'])).toEqual(['wiki/concepts/a.md']);
  });

  it('reads a null section, in an error-free response, as an empty section', async () => {
    const repository = treeRepository({ 'wiki/concepts/a.md': oid(1) });
    repository['questions'] = WIRE_NULL;
    const api = backend({
      treeBody: JSON.stringify({ data: { repository } }),
      stored: { 'wiki/concepts/a.md': oid(1), 'wiki/questions/why.md': oid(2) },
    });

    const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

    expect(summary).toMatchObject({ ok: true, changed: 0, removed: 1 });
    expect(deletedPaths(api)).toBe('in.("wiki/questions/why.md")');
  });

  describe('a failed run records last_error and leaves the pages untouched', () => {
    const stored = { 'wiki/concepts/a.md': oid(1), 'wiki/entities/b.md': oid(2) };

    it('a GraphQL errors response', async () => {
      const api = backend({
        stored,
        treeBody: JSON.stringify({
          data: WIRE_NULL,
          errors: [{ message: 'API rate limit exceeded' }],
        }),
      });

      const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

      expect(summary).toEqual({
        ok: false,
        error: expect.stringContaining('rate limit') as unknown,
      });
      expectRecordedFailure(api, 'API rate limit exceeded');
      // The select, GraphQL #1, then nothing but the failure write.
      expect(api.calls).toHaveLength(3);
    });

    it('an errors-with-partial-data response — never read as "every page was deleted"', async () => {
      // The ref resolved and two sections came back empty; the errors array is what says they
      // are not really empty. Trusting the data would delete both stored pages.
      const repository = treeRepository({});
      repository['concepts'] = WIRE_NULL;
      repository['entities'] = WIRE_NULL;
      const api = backend({
        stored,
        treeBody: JSON.stringify({
          data: { repository },
          errors: [{ message: 'Something went wrong while executing your query.' }],
        }),
      });

      const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

      expect(summary).toMatchObject({ ok: false });
      expectRecordedFailure(api, 'Something went wrong');
    });

    it('a null ref', async () => {
      const repository = treeRepository({});
      repository['ref'] = WIRE_NULL;
      const api = backend({ stored, treeBody: JSON.stringify({ data: { repository } }) });

      const summary = await syncWiki(env, { fetch: api.fetch, now: NOW });

      expect(summary).toMatchObject({ ok: false });
      expectRecordedFailure(api, 'refs/heads/main');
    });

    it('a null repository (the token cannot see it)', async () => {
      const api = backend({
        stored,
        treeBody: JSON.stringify({ data: { repository: WIRE_NULL } }),
      });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      expectRecordedFailure(api, 'ac3charland/knowledge');
    });

    it('a non-2xx from GitHub', async () => {
      const api = backend({ stored, failOn: (call) => call.url.includes('graphql') });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      expectRecordedFailure(api, '500 upstream broke');
    });

    it('GraphQL #2 answering with a non-2xx', async () => {
      const api = backend({
        tree: { ...stored, 'wiki/concepts/new.md': oid(7) },
        stored,
        failOn: (call) =>
          call.url.includes('graphql') && (call.body as { query: string }).query.includes('Blob'),
      });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      expectRecordedFailure(api, 'blobs');
    });

    it('GraphQL #2 answering with errors beside partial data', async () => {
      // One blob resolved, the other is null and an errors entry says why. Storing the one that
      // came back would be a half-applied run; the whole run fails and writes nothing instead.
      const api = backend({
        tree: { ...stored, 'wiki/concepts/new.md': oid(7), 'wiki/concepts/other.md': oid(8) },
        stored,
        blobsBody: JSON.stringify({
          data: {
            repository: {
              p0: { text: '# New', isBinary: false, isTruncated: false },
              p1: WIRE_NULL,
            },
          },
          errors: [{ message: 'Could not resolve to a Blob' }],
        }),
      });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      expectRecordedFailure(api, 'Could not resolve to a Blob');
    });

    it('a failed upsert sends no delete — the delete never races it', async () => {
      const api = backend({
        tree: { 'wiki/concepts/a.md': oid(9) },
        stored,
        failOn: (call) => call.url.includes('/rest/v1/wiki_pages?on_conflict'),
      });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      // The upsert was attempted (and failed); the removal of b.md was never sent.
      expect(api.upserts()).toHaveLength(1);
      expect(api.deletes()).toEqual([]);
      expect(api.stateWrites()).toHaveLength(1);
      expect(api.stateWrites()[0]?.body).toMatchObject({
        last_error: expect.stringContaining('upsert wiki_pages') as unknown,
      });
    });

    it('the select failing', async () => {
      const api = backend({ tree: stored, failOn: (call) => call.method === 'GET' });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).resolves.toMatchObject({
        ok: false,
      });

      expectRecordedFailure(api, 'GET wiki_pages');
    });

    it('rejects when even the failure write fails, so the caller can log it', async () => {
      expect.assertions(1);
      const api = backend({ failOn: () => true });

      await expect(syncWiki(env, { fetch: api.fetch, now: NOW })).rejects.toThrow('wiki_sync');
    });
  });

  it('spends no more than six subrequests in any scenario', async () => {
    const tree: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1) {
      tree[`wiki/concepts/p-${String(index).padStart(3, '0')}.md`] = oid(index + 1);
    }
    const stored: Record<string, string> = {};
    for (let index = 0; index < 50; index += 1)
      stored[`wiki/entities/gone-${String(index)}.md`] = oid(index + 900);

    const scenarios = [
      backend({ tree, stored }),
      backend({ tree, stored, failOn: (call) => call.method === 'DELETE' }),
      backend({
        tree,
        stored,
        failOn: (call) => call.url.includes('/rest/v1/wiki_pages?on_conflict'),
      }),
      backend({ tree, stored, failOn: (call) => call.url.includes('wiki_sync') }),
    ];
    for (const api of scenarios) {
      await syncWiki(env, { fetch: api.fetch, now: NOW }).catch(() => 'rejected');
      expect(api.calls.length).toBeLessThanOrEqual(WIKI_SYNC_SUBREQUEST_CEILING);
    }
    expect(WIKI_SYNC_SUBREQUEST_CEILING).toBe(6);
  });

  it('uses the global fetch and the real clock when handed neither', async () => {
    const spy = spyOnFetch().mockImplementation((input) =>
      Promise.resolve(
        (input as string).includes('graphql')
          ? Response.json({ data: { repository: treeRepository({}) } })
          : Response.json([]),
      ),
    );

    const summary = await syncWiki(env);

    expect(summary).toMatchObject({ ok: true, changed: 0 });
    expect(spy).toHaveBeenCalledTimes(3);
    const state = JSON.parse(spy.mock.calls[2]?.[1]?.body as string) as { synced_at: string };
    expect(Number.isNaN(Date.parse(state.synced_at))).toBe(false);
  });
});
