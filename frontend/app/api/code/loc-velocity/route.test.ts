/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
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
const mockCreateAdminClient = jest.mocked(createAdminClient);

const API_KEY = 'ingest-key-abc';
const TEST_USER = { id: 'user-123' };

/** A project row as the route selects it — oldest first, the order the table answers in. */
interface ProjectRepoRow {
  name: string;
  repo_owner: string;
  repo_name: string;
}

const PROJECTS: ProjectRepoRow[] = [
  { name: 'RealPlay', repo_owner: 'ac3charland', repo_name: 'realplay' },
  { name: 'Alfred', repo_owner: 'ac3charland', repo_name: 'alfred' },
];

interface ProjectsRead {
  data: ProjectRepoRow[] | null;
  error: { message: string; code?: string } | null;
}

/**
 * A Supabase stub that says whether a session exists and answers the one `projects` read the
 * route makes. The spies are returned so a test can assert which client served the read and
 * how it was ordered.
 */
function makeSupabase(user: { id: string } | undefined, read: ProjectsRead) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(read),
  };
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

const READ_OK: ProjectsRead = { data: PROJECTS, error: null };

/** A signed-in browser session whose `projects` read answers `read`. */
function signedIn(read: ProjectsRead = READ_OK) {
  const supabase = makeSupabase(TEST_USER, read);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** No session at all; a keyed caller is served by the admin client, which answers `read`. */
function keyedCaller(read: ProjectsRead = READ_OK) {
  mockCreateClient.mockResolvedValue(makeSupabase(undefined, { data: [], error: null }) as never);
  const admin = makeSupabase(undefined, read);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

/**
 * Stub the per-repo statistics fan-out: one queued response per repo, in project order.
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
    process.env.PR_RATIO_AUTHORS = 'ac3charland';
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    globalThis.fetch = originalFetch;
  });

  describe('auth', () => {
    it('returns 401 with neither a session nor an API key', async () => {
      mockCreateClient.mockResolvedValue(makeSupabase(undefined, READ_OK) as never);
      const requested = mockGithub([{ status: 200, body: [] }]);

      const response = await GET(getRequest());

      expect(response.status).toBe(401);
      // Nothing reaches GitHub on an unauthenticated call.
      expect(requested).toHaveLength(0);
    });

    it('reads the projects through the session client for a browser session', async () => {
      const supabase = signedIn();
      mockGithub([{ status: 200, body: [] }]);

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(supabase.from).toHaveBeenCalledWith('projects');
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it('reads the projects through the ADMIN client for a valid x-api-key', async () => {
      const admin = keyedCaller();
      mockGithub([{ status: 200, body: [] }]);

      const response = await GET(getRequest('', { 'x-api-key': API_KEY }));

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('projects');
      expect(((await response.json()) as LocVelocityResponse).weeks).toHaveLength(12);
    });

    it('accepts the key as an Authorization: Bearer token too', async () => {
      const admin = keyedCaller();
      mockGithub([{ status: 200, body: [] }]);

      const response = await GET(getRequest('', { authorization: `Bearer ${API_KEY}` }));

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('projects');
    });
  });

  it('returns the documented envelope across the project repos, oldest project first', async () => {
    const supabase = signedIn();
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());
    expect(response.status).toBe(200);

    expect(supabase._chain.select).toHaveBeenCalledWith('name, repo_owner, repo_name');
    expect(supabase._chain.order).toHaveBeenCalledWith('created_at', { ascending: true });

    const body = (await response.json()) as LocVelocityResponse;
    expect(body.weeks).toHaveLength(12);
    expect(body.averageWeeks).toBe(4);
    expect(body.repos).toStrictEqual(['ac3charland/realplay', 'ac3charland/alfred']);
    expect(requested).toStrictEqual([
      'https://api.github.com/repos/ac3charland/realplay/stats/contributors',
      'https://api.github.com/repos/ac3charland/alfred/stats/contributors',
    ]);
    // Oldest first, and only the newest bucket is the week still filling.
    expect(body.weeks.filter((week) => week.partial)).toHaveLength(1);
    expect(body.weeks.at(-1)?.partial).toBe(true);
  });

  it('takes no query params — the buckets are GitHub’s Sunday-UTC weeks either way', async () => {
    signedIn();
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest('?tz=America/New_York'));

    expect(response.status).toBe(200);
  });

  it('returns 501 without a token, so the card renders nothing at all', async () => {
    signedIn();
    delete process.env.GITHUB_TOKEN;
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(501);
    expect(await response.json()).toStrictEqual({
      error: 'Lines-changed velocity is not configured',
    });
    expect(requested).toHaveLength(0);
  });

  it('returns 501 with no projects at all', async () => {
    signedIn({ data: [], error: null });
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(501);
    expect(requested).toHaveLength(0);
  });

  it('answers from a SINGLE project — unlike the ratio, one repo is a series', async () => {
    signedIn({ data: PROJECTS.slice(1), error: null });
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(((await response.json()) as LocVelocityResponse).repos).toStrictEqual([
      'ac3charland/alfred',
    ]);
  });

  it('maps a failed projects read to its status — never 501, which would hide the card', async () => {
    signedIn({ data: null, error: { message: 'connection refused' } });
    const requested = mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'connection refused' });
    expect(requested).toHaveLength(0);
  });

  it('returns 202 while GitHub is still computing the statistics', async () => {
    signedIn();
    mockGithub([{ status: 202 }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toStrictEqual({
      error: 'GitHub is still computing these statistics',
    });
  });

  it('returns 502 when a GitHub request fails', async () => {
    signedIn();
    mockGithub([{ status: 503 }]);

    const response = await GET(getRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({ error: 'GitHub request failed' });
  });

  it('never leaks the GitHub token into the response', async () => {
    signedIn();
    mockGithub([{ status: 200, body: [] }]);

    const response = await GET(getRequest());

    expect(await response.text()).not.toContain('ghp_test');
  });
});
