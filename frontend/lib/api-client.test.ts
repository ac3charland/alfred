/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * The Reader module's client wrappers, pinned at the seam they exist for: which path each one
 * calls, with which method and body, and what it hands back. The wrappers are the contract the
 * stores are written against, so a renamed route or a dropped body key fails here rather than in
 * a browser.
 */
import {
  createReaderPublication,
  fetchCommsSnapshot,
  fetchReaderCandidates,
  fetchReaderHealth,
  fetchReaderPublications,
  fetchWikiPageBody,
  fetchWikiPages,
  searchWikiBodies,
  sendItemsToWiki,
  sendReaderIdeasToWiki,
  updateReaderPublication,
} from './api-client';
import {
  makeReaderCandidate,
  makeReaderHealth,
  makeReaderPublication,
  makeReaderPublicationListItem,
  resetReaderFixtureClock,
} from './reader/fixtures';
import { makeWikiPage, makeWikiSync, resetWikiFixtureClock, toWikiIndexRow } from './wiki/fixtures';

const PUBLICATION_ID = '22222222-2222-4222-8222-222222222222';

const originalFetch = globalThis.fetch;

/** Stub `fetch` with one JSON response and return the mock, so a test can read the call back. */
function stubFetch(payload: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue(Response.json(payload, { status: 200 }));
  globalThis.fetch = mock;
  return mock;
}

/** The path and the parsed init of the one recorded request. */
function requested(mock: jest.Mock): { path: string; method: string; body: unknown } {
  const [path, init] = mock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    path,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  resetReaderFixtureClock();
  resetWikiFixtureClock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchReaderPublications', () => {
  it('reads the roster from the publications route', async () => {
    const roster = [makeReaderPublicationListItem('Second Thoughts')];
    const spy = stubFetch(roster);

    await expect(fetchReaderPublications()).resolves.toEqual(roster);
    expect(requested(spy)).toMatchObject({ path: '/api/reader/publications', method: 'GET' });
  });
});

describe('createReaderPublication', () => {
  it('posts the handle and name and hands back the stored row', async () => {
    const saved = makeReaderPublication('Example Weekly', { handle: 'news@example.com' });
    const spy = stubFetch(saved);

    await expect(
      createReaderPublication({ handle: 'news@example.com', name: 'Example Weekly' }),
    ).resolves.toEqual(saved);
    expect(requested(spy)).toEqual({
      path: '/api/reader/publications',
      method: 'POST',
      body: { handle: 'news@example.com', name: 'Example Weekly' },
    });
  });
});

describe('updateReaderPublication', () => {
  it('patches the one publication by id, sending only the keys it was given', async () => {
    const saved = makeReaderPublication('Example Weekly', { enabled: false });
    const spy = stubFetch(saved);

    await expect(updateReaderPublication(PUBLICATION_ID, { enabled: false })).resolves.toEqual(
      saved,
    );
    expect(requested(spy)).toEqual({
      path: `/api/reader/publications/${PUBLICATION_ID}`,
      method: 'PATCH',
      body: { enabled: false },
    });
  });
});

describe('fetchReaderCandidates', () => {
  it('reads the candidates from the roster route’s own segment', async () => {
    const candidates = [makeReaderCandidate('news@example.com')];
    const spy = stubFetch(candidates);

    await expect(fetchReaderCandidates()).resolves.toEqual(candidates);
    expect(requested(spy)).toMatchObject({
      path: '/api/reader/publications/candidates',
      method: 'GET',
    });
  });
});

describe('fetchReaderHealth', () => {
  it('reads the snapshot the health surface is derived from', async () => {
    const snapshot = { health: makeReaderHealth('live'), account: undefined };
    const spy = stubFetch(snapshot);

    await expect(fetchReaderHealth()).resolves.toEqual(snapshot);
    expect(requested(spy)).toMatchObject({ path: '/api/reader/health', method: 'GET' });
  });
});

describe('fetchWikiPages', () => {
  it('reads the whole index plus the sync row from the pages route', async () => {
    const seed = {
      pages: [toWikiIndexRow(makeWikiPage('wiki/concepts/habit-stacking.md'))],
      sync: makeWikiSync(),
    };
    const spy = stubFetch(seed);

    await expect(fetchWikiPages()).resolves.toEqual(seed);
    expect(requested(spy)).toMatchObject({ path: '/api/wiki/pages', method: 'GET' });
  });
});

describe('fetchWikiPageBody', () => {
  it('reads one page body from the page route, encoding the path in the query', async () => {
    const body = { path: 'wiki/concepts/spaced page.md', blob_oid: 'b1', body: '# Spaced page' };
    const spy = stubFetch(body);

    await expect(fetchWikiPageBody('wiki/concepts/spaced page.md')).resolves.toEqual(body);
    expect(requested(spy)).toMatchObject({
      path: '/api/wiki/page?path=wiki%2Fconcepts%2Fspaced%20page.md',
      method: 'GET',
    });
  });
});

describe('searchWikiBodies', () => {
  it('reads ranked hits from the search route, encoding the query', async () => {
    const hits = [
      { path: 'wiki/concepts/habit-stacking.md', snippet: '\u0002habit\u0003', rank: 1 },
    ];
    const spy = stubFetch(hits);

    await expect(searchWikiBodies('habit stacking')).resolves.toEqual(hits);
    expect(requested(spy)).toMatchObject({
      path: '/api/wiki/search?q=habit%20stacking',
      method: 'GET',
    });
  });
});

describe('sendReaderIdeasToWiki', () => {
  it('posts the picked bullets to the post’s wiki route and hands back the updated row', async () => {
    const saved = { id: 'post-1', wiki_sent_ideas: ['A new habit needs an existing cue.'] };
    const spy = stubFetch(saved);

    await expect(
      sendReaderIdeasToWiki('post-1', { ideas: ['A new habit needs an existing cue.'] }),
    ).resolves.toEqual(saved);
    expect(requested(spy)).toEqual({
      path: '/api/reader/posts/post-1/wiki',
      method: 'POST',
      body: { ideas: ['A new habit needs an existing cue.'] },
    });
  });
});

describe('sendItemsToWiki', () => {
  it('posts the dispatched ids to the items route and hands back the ones sent', async () => {
    const sent = { sent: ['11111111-1111-4111-8111-111111111111'] };
    const spy = stubFetch(sent);

    await expect(
      sendItemsToWiki({ ids: ['11111111-1111-4111-8111-111111111111'] }),
    ).resolves.toEqual(sent);
    expect(requested(spy)).toEqual({
      path: '/api/wiki/items',
      method: 'POST',
      body: { ids: ['11111111-1111-4111-8111-111111111111'] },
    });
  });
});

describe('fetchCommsSnapshot', () => {
  it('gives up after 15s, so a hung read fails rather than holding the view', async () => {
    const timeout = new AbortController();
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    // A server that never answers: only the signal ends the request.
    globalThis.fetch = jest.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out.', 'TimeoutError'));
          });
        }),
    ) as unknown as typeof fetch;

    const read = fetchCommsSnapshot(50);
    timeout.abort();

    await expect(read).rejects.toThrow('timed out');
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    timeoutSpy.mockRestore();
  });
});
