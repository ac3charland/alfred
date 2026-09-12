/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';
import type { LocVelocityResponse } from '@/lib/types';

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
 * Stub the per-repo statistics fan-out: one queued response per repo, in configured order.
 * Returns the URLs it was asked for, so a test can assert what the route sent.
 */
function mockGithub(responses: { status: number; body?: unknown }[]): string[] {
  const requested: string[] = [];
  let call = 0;
  globalThis.fetch = ((input: string) => {
    requested.push(input);
    const response = responses[call] ?? responses.at(-1);
    call += 1;
    return Promise.resolve({
      ok: (response?.status ?? 200) < 400,
      status: response?.status ?? 200,
      json: () => Promise.resolve(response?.body ?? []),
    });
  }) as unknown as typeof fetch;
  return requested;
}

function getRequest(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/code/loc-velocity${query}`, { headers });
}

describe('GET /api/code/loc-velocity', () => {
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
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    // Nothing reaches GitHub on an unauthenticated call.
    expect(requested).toHaveLength(0);
  });

  it('returns the documented envelope for an authenticated browser session', async () => {
    mockSession(TEST_USER);
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as LocVelocityResponse;
    expect(body.weeks).toHaveLength(12);
    expect(body.averageWeeks).toBe(4);
    expect(body.repos).toStrictEqual(['ac3charland/realplay', 'ac3charland/alfred']);
    expect(body.authors).toStrictEqual(['ac3charland']);
    // Oldest first, and only the newest bucket is the week still filling.
    expect(body.weeks.filter((week) => week.partial)).toHaveLength(1);
    expect(body.weeks.at(-1)?.partial).toBe(true);
  });

  it('returns the same envelope for a valid x-api-key, without a session', async () => {
    mockSession(undefined);
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest('', { 'x-api-key': API_KEY }));

    expect(response.status).toBe(200);
    expect(((await response.json()) as LocVelocityResponse).weeks).toHaveLength(12);
  });

  it('returns the same envelope for a valid Authorization: Bearer key', async () => {
    mockSession(undefined);
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest('', { authorization: `Bearer ${API_KEY}` }));

    expect(response.status).toBe(200);
  });

  it('takes no query params — the buckets are GitHub’s Sunday-UTC weeks either way', async () => {
    mockSession(TEST_USER);
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest('?tz=America/New_York'));

    expect(response.status).toBe(200);
  });

  it('returns 501 when no repo is configured, so the card renders nothing at all', async () => {
    mockSession(TEST_USER);
    delete process.env.GITHUB_TOKEN;
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(501);
    expect(await response.json()).toStrictEqual({
      error: 'Lines-changed velocity is not configured',
    });
    expect(requested).toHaveLength(0);
  });

  it('answers from a SINGLE configured repo — unlike the ratio, one repo is a series', async () => {
    mockSession(TEST_USER);
    process.env.PR_RATIO_REPOS = 'ac3charland/alfred:Alfred';
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(((await response.json()) as LocVelocityResponse).repos).toStrictEqual([
      'ac3charland/alfred',
    ]);
  });

  it('returns 202 while GitHub is still computing the statistics', async () => {
    mockSession(TEST_USER);
    mockGithub([{ status: 202 }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toStrictEqual({
      error: 'GitHub is still computing these statistics',
    });
  });

  it('returns 502 when a GitHub request fails', async () => {
    mockSession(TEST_USER);
    mockGithub([{ status: 503 }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({ error: 'GitHub request failed' });
  });

  it('never leaks the GitHub token into the response', async () => {
    mockSession(TEST_USER);
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(await response.text()).not.toContain('ghp_test');
  });
});
