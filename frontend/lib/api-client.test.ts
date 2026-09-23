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
  updateReaderPublication,
} from './api-client';
import {
  makeReaderCandidate,
  makeReaderHealth,
  makeReaderPublication,
  makeReaderPublicationListItem,
  resetReaderFixtureClock,
} from './reader/fixtures';

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
