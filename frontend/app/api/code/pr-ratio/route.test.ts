/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

// Neutralise `import 'server-only'` reached through the GitHub fan-out under Jest.
jest.mock('server-only', () => ({}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const API_KEY = 'ingest-key-abc';
const TEST_USER = { id: 'user-123' };

/** Supabase stub whose only job is to say whether a session exists. */
function mockSession(user: { id: string } | undefined) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

/**
 * Stub GitHub search: one `total_count` per configured repo, in query order. Returns the
 * search URLs it was asked for, so a test can assert what the route sent without reading
 * `mock.calls` (which is `any`).
 */
function mockGithub(totals: number[], { ok = true }: { ok?: boolean } = {}): URL[] {
  const requested: URL[] = [];
  let call = 0;
  globalThis.fetch = ((input: string) => {
    requested.push(new URL(input));
    const total = totals[call] ?? 0;
    call += 1;
    return Promise.resolve({
      ok,
      status: ok ? 200 : 503,
      json: () => Promise.resolve({ total_count: total }),
    });
  }) as unknown as typeof fetch;
  return requested;
}

function getRequest(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/code/pr-ratio${query}`, { headers });
}

interface RatioBody {
  week: { start: string; end: string; timezone: string };
  total: number;
  repos: { repo: string; label: string; count: number; percentage: number }[];
}

describe('GET /api/code/pr-ratio', () => {
  const originalEnvironment = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.INGEST_API_KEY = API_KEY;
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.PR_RATIO_REPOS = 'ac3charland/realplay:RealPlay,ac3charland/alfred:Alfred';
    process.env.PR_RATIO_AUTHORS = 'ac3charland';
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    globalThis.fetch = originalFetch;
  });

  it('returns 401 with neither a session nor an API key', async () => {
    mockSession(undefined);
    const requested = mockGithub([3, 6]);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
    // Nothing reaches GitHub on an unauthenticated call.
    expect(requested).toHaveLength(0);
  });

  it('returns the documented envelope for an authenticated browser session', async () => {
    mockSession(TEST_USER);
    mockGithub([3, 6]);

    const response = await GET(getRequest('?tz=America/New_York'));
    expect(response.status).toBe(200);

    const body = (await response.json()) as RatioBody;
    expect(body.total).toBe(9);
    expect(body.repos).toEqual([
      { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
      { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
    ]);
    expect(body.repos.reduce((sum, repo) => sum + repo.percentage, 0)).toBe(100);
  });

  it('returns the same envelope for a valid x-api-key, without a session', async () => {
    mockSession(undefined);
    mockGithub([3, 6]);

    const response = await GET(getRequest('', { 'x-api-key': API_KEY }));
    const body = (await response.json()) as RatioBody;

    expect(response.status).toBe(200);
    expect(body.total).toBe(9);
  });

  it('returns the same envelope for a valid Authorization: Bearer key', async () => {
    mockSession(undefined);
    mockGithub([3, 6]);

    const response = await GET(getRequest('', { authorization: `Bearer ${API_KEY}` }));
    const body = (await response.json()) as RatioBody;

    expect(response.status).toBe(200);
    expect(body.total).toBe(9);
  });

  it('evaluates the week in the requested timezone and echoes it back', async () => {
    mockSession(TEST_USER);
    const requested = mockGithub([1, 1]);

    const response = await GET(getRequest('?tz=America/New_York'));
    const body = (await response.json()) as RatioBody;

    expect(body.week.timezone).toBe('America/New_York');
    // Both ends are a local midnight carrying the zone's offset, not UTC.
    expect(body.week.start).toMatch(/T00:00:00-0[45]:00$/);
    expect(body.week.end).toMatch(/T00:00:00-0[45]:00$/);
    // The very window the caller is told about is the one GitHub was asked for.
    const [first] = requested;
    expect(first?.searchParams.get('q')).toContain(`merged:${body.week.start}..${body.week.end}`);
  });

  it('defaults to UTC when no tz is given', async () => {
    mockSession(TEST_USER);
    mockGithub([1, 1]);

    const response = await GET(getRequest());
    const body = (await response.json()) as RatioBody;

    expect(body.week.timezone).toBe('UTC');
    expect(body.week.start).toMatch(/T00:00:00\+00:00$/);
  });

  it('degrades an unrecognized tz to UTC rather than erroring', async () => {
    mockSession(TEST_USER);
    mockGithub([1, 1]);

    const response = await GET(getRequest('?tz=Not/AZone'));
    const body = (await response.json()) as RatioBody;

    expect(response.status).toBe(200);
    expect(body.week.timezone).toBe('UTC');
  });

  it('returns 501 when the feature is not configured, so the Backlog can render nothing', async () => {
    mockSession(TEST_USER);
    delete process.env.GITHUB_TOKEN;
    const requested = mockGithub([3, 6]);

    const response = await GET(getRequest());

    expect(response.status).toBe(501);
    expect(await response.json()).toStrictEqual({ error: 'PR ratio is not configured' });
    expect(requested).toHaveLength(0);
  });

  it('returns 501 when fewer than two repos are configured', async () => {
    mockSession(TEST_USER);
    process.env.PR_RATIO_REPOS = 'ac3charland/alfred:Alfred';

    const response = await GET(getRequest());

    expect(response.status).toBe(501);
  });

  it('returns 502 when a GitHub request fails', async () => {
    mockSession(TEST_USER);
    mockGithub([0, 0], { ok: false });

    const response = await GET(getRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({ error: 'GitHub request failed' });
  });

  it('never leaks the GitHub token into the response', async () => {
    mockSession(TEST_USER);
    mockGithub([3, 6]);

    const response = await GET(getRequest());
    const body = await response.text();

    expect(body).not.toContain('ghp_test');
  });
});
