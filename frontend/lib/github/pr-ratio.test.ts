import type { PrRatioConfig } from './config';
import { buildSearchQuery, fetchPrRatio, toPercentages } from './pr-ratio';
import type { WeekWindow } from './week';

jest.mock('server-only', () => ({}));

const WEEK: WeekWindow = {
  start: '2026-07-20T00:00:00-04:00',
  end: '2026-07-27T00:00:00-04:00',
  timezone: 'America/New_York',
};

const REALPLAY = { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' };
const ALFRED = { owner: 'ac3charland', name: 'alfred', label: 'Alfred' };

const CONFIG: PrRatioConfig = {
  repos: [REALPLAY, ALFRED],
  authors: ['ac3charland'],
  token: 'ghp_test',
};

/** One recorded call to the stubbed GitHub search. */
interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

/**
 * Stub `fetch` with one response per repo, in the order the queries are issued, and record
 * what each call asked for. Recording here (rather than reading `mock.calls`) keeps the
 * request typed instead of `any`.
 */
function mockSearchResponses(responses: { ok: boolean; totalCount?: number }[]): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  let call = 0;
  globalThis.fetch = ((input: string, init: { headers: Record<string, string> }) => {
    recorded.push({ url: new URL(input), headers: init.headers });
    const response = responses[call] ?? { ok: true, totalCount: 0 };
    call += 1;
    return Promise.resolve({
      ok: response.ok,
      status: response.ok ? 200 : 502,
      json: () => Promise.resolve({ total_count: response.totalCount ?? 0 }),
    });
  }) as unknown as typeof fetch;
  return recorded;
}

/** The `q=` search query of a recorded call. */
function queryOf(recorded: RecordedRequest[], index: number): string {
  return recorded[index]?.url.searchParams.get('q') ?? '';
}

describe('buildSearchQuery', () => {
  it('scopes to the repo, to merged PRs, and to the week window', () => {
    const query = buildSearchQuery(REALPLAY, WEEK, []);

    expect(query).toContain('repo:ac3charland/realplay');
    expect(query).toContain('is:pr');
    expect(query).toContain('is:merged');
    expect(query).toContain(`merged:${WEEK.start}..${WEEK.end}`);
  });

  it('adds one author: qualifier per configured login (GitHub ORs repeated qualifiers)', () => {
    const query = buildSearchQuery(REALPLAY, WEEK, ['ac3charland', 'claude-bot']);

    expect(query).toContain('author:ac3charland');
    expect(query).toContain('author:claude-bot');
    expect(query).not.toContain('-author:');
  });

  it('excludes the dependency bots ONLY when no authors are configured', () => {
    const query = buildSearchQuery(REALPLAY, WEEK, []);

    expect(query).toContain('-author:app/dependabot');
    expect(query).toContain('-author:app/renovate');
    expect(query).toContain('-author:app/github-actions');
  });
});

describe('toPercentages', () => {
  it('hands the leftover point to the largest remainder so the labels sum to exactly 100', () => {
    // Naive rounding gives 33 + 66 = 99; largest-remainder gives the point to the 2/3 share.
    expect(toPercentages([3, 6])).toEqual([33, 67]);
    expect(toPercentages([3, 6]).reduce((sum, part) => sum + part, 0)).toBe(100);
  });

  it('sums to 100 for a three-way split of thirds', () => {
    expect(toPercentages([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('breaks a remainder tie by configured order', () => {
    expect(toPercentages([1, 1, 1, 1, 1, 1])).toEqual([17, 17, 17, 17, 16, 16]);
  });

  it('leaves exact shares untouched', () => {
    expect(toPercentages([1, 1])).toEqual([50, 50]);
    expect(toPercentages([4, 1])).toEqual([80, 20]);
  });

  it('yields all zeros — never NaN, never an even split — when every count is zero', () => {
    expect(toPercentages([0, 0])).toEqual([0, 0]);
  });

  it('gives a single non-zero segment the whole bar', () => {
    expect(toPercentages([0, 5])).toEqual([0, 100]);
  });
});

describe('fetchPrRatio', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('counts each repo from its search total and returns them in configured order', async () => {
    mockSearchResponses([
      { ok: true, totalCount: 3 },
      { ok: true, totalCount: 6 },
    ]);

    await expect(fetchPrRatio(CONFIG, WEEK)).resolves.toEqual({
      week: WEEK,
      total: 9,
      repos: [
        { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
        { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
      ],
    });
  });

  it('issues one authenticated request per repo, asking for a single item', async () => {
    const recorded = mockSearchResponses([
      { ok: true, totalCount: 1 },
      { ok: true, totalCount: 1 },
    ]);

    await fetchPrRatio(CONFIG, WEEK);

    expect(recorded).toHaveLength(2);
    expect(queryOf(recorded, 0)).toContain('repo:ac3charland/realplay');
    expect(queryOf(recorded, 1)).toContain('repo:ac3charland/alfred');

    const [first] = recorded;
    expect(first?.url.origin).toBe('https://api.github.com');
    expect(first?.url.pathname).toBe('/search/issues');
    expect(first?.url.searchParams.get('per_page')).toBe('1');

    expect(first?.headers['Authorization']).toBe('Bearer ghp_test');
    expect(first?.headers['Accept']).toBe('application/vnd.github+json');
    expect(first?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    // GitHub rejects API requests with no User-Agent.
    expect(first?.headers['User-Agent']).toBe('alfred');
  });

  it('fails the WHOLE call when any repo request fails — a partial ratio is a wrong ratio', async () => {
    mockSearchResponses([{ ok: true, totalCount: 3 }, { ok: false }]);

    await expect(fetchPrRatio(CONFIG, WEEK)).resolves.toBeUndefined();
  });

  it('fails the whole call when a repo request throws (network / DNS)', async () => {
    globalThis.fetch = () => Promise.reject(new Error('ECONNRESET'));

    await expect(fetchPrRatio(CONFIG, WEEK)).resolves.toBeUndefined();
  });

  it('reports a zero-PR week as zeros rather than as a failure', async () => {
    mockSearchResponses([
      { ok: true, totalCount: 0 },
      { ok: true, totalCount: 0 },
    ]);

    await expect(fetchPrRatio(CONFIG, WEEK)).resolves.toEqual({
      week: WEEK,
      total: 0,
      repos: [
        { repo: 'ac3charland/realplay', label: 'RealPlay', count: 0, percentage: 0 },
        { repo: 'ac3charland/alfred', label: 'Alfred', count: 0, percentage: 0 },
      ],
    });
  });
});
