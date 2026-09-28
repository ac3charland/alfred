/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
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
 * Stub GitHub search: one `total_count` per measured repo, in query order. Returns the
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
  other?: { count: number; percentage: number };
}

describe('GET /api/code/pr-ratio', () => {
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
    // Only the window tests pin the clock; the rest run on the real one.
    jest.useRealTimers();
  });

  describe('auth', () => {
    it('returns 401 with neither a session nor an API key', async () => {
      mockCreateClient.mockResolvedValue(makeSupabase(undefined, READ_OK) as never);
      const requested = mockGithub([3, 6]);

      const response = await GET(getRequest());

      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
      // Nothing reaches GitHub on an unauthenticated call.
      expect(requested).toHaveLength(0);
    });

    it('reads the projects through the session client for a browser session', async () => {
      const supabase = signedIn();
      mockGithub([3, 6, 1]);

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(supabase.from).toHaveBeenCalledWith('projects');
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it('reads the projects through the ADMIN client for a valid x-api-key', async () => {
      // A keyed caller carries no cookie: a session client would read the projects
      // anonymously, find none, and answer 501 — "not configured" — to a configured deployment.
      const admin = keyedCaller();
      mockGithub([3, 6, 1]);

      const response = await GET(getRequest('', { 'x-api-key': API_KEY }));
      const body = (await response.json()) as RatioBody;

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('projects');
      expect(body.total).toBe(10);
    });

    it('accepts the key as an Authorization: Bearer token too', async () => {
      const admin = keyedCaller();
      mockGithub([3, 6, 1]);

      const response = await GET(getRequest('', { authorization: `Bearer ${API_KEY}` }));

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('projects');
    });
  });

  describe('the measured repos are the projects', () => {
    it('reads each project’s name and repo, oldest first', async () => {
      const supabase = signedIn();
      mockGithub([3, 6, 1]);

      await GET(getRequest());

      expect(supabase._chain.select).toHaveBeenCalledWith('name, repo_owner, repo_name');
      expect(supabase._chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('answers one entry per project, in that order, labelled by the project’s name', async () => {
      signedIn();
      mockGithub([3, 6, 1]);

      const response = await GET(getRequest('?tz=America/New_York'));
      expect(response.status).toBe(200);

      const body = (await response.json()) as RatioBody;
      expect(body.total).toBe(10);
      expect(body.repos).toEqual([
        { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 30 },
        { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 60 },
      ]);
      expect(body.other).toEqual({ count: 1, percentage: 10 });
    });

    it('asks GitHub about exactly the project repos, and subtracts every one from Other', async () => {
      signedIn({
        data: [...PROJECTS, { name: 'Lumen', repo_owner: 'ac3charland', repo_name: 'lumen' }],
        error: null,
      });
      const requested = mockGithub([1, 1, 1, 1]);

      await GET(getRequest());

      const queries = requested.map((url) => url.searchParams.get('q') ?? '');
      expect(queries.slice(0, 3).map((query) => /repo:(\S+)/.exec(query)?.[1])).toEqual([
        'ac3charland/realplay',
        'ac3charland/alfred',
        'ac3charland/lumen',
      ]);
      const other = queries.at(-1) ?? '';
      expect(other).toContain('-repo:ac3charland/realplay');
      expect(other).toContain('-repo:ac3charland/alfred');
      expect(other).toContain('-repo:ac3charland/lumen');
    });

    it('ignores a leftover PR_RATIO_REPOS', async () => {
      process.env['PR_RATIO_REPOS'] = 'someone/else:Elsewhere,another/repo:Another';
      signedIn();
      mockGithub([3, 6, 1]);

      const response = await GET(getRequest());
      const body = (await response.json()) as RatioBody;

      expect(body.repos.map((repo) => repo.label)).toEqual(['RealPlay', 'Alfred']);
    });
  });

  describe('the window', () => {
    it('measures the seven days ending at the moment of the request', async () => {
      signedIn();
      // Friday afternoon — the hour the weekly review is actually held.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-24T20:00:00Z'));
      const requested = mockGithub([1, 1]);

      const response = await GET(getRequest('?tz=America/New_York'));
      const body = (await response.json()) as RatioBody;

      // The window reaches back past the weekend a Monday-anchored week would have dropped.
      expect(body.week.start).toBe('2026-07-17T16:00:00-04:00');
      expect(body.week.end).toBe('2026-07-24T16:00:00-04:00');
      // The very window the caller is told about is the one GitHub was asked for.
      const [first] = requested;
      expect(first?.searchParams.get('q')).toContain(`merged:${body.week.start}..${body.week.end}`);
    });

    it('rolls with the clock rather than resetting on Monday', async () => {
      signedIn();
      // Monday morning: the old window would have been half an hour long.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-27T00:30:00Z'));
      mockGithub([1, 1]);

      const response = await GET(getRequest());
      const body = (await response.json()) as RatioBody;

      expect(body.week.start).toBe('2026-07-20T00:30:00+00:00');
      expect(body.week.end).toBe('2026-07-27T00:30:00+00:00');
    });

    it('evaluates the window in the requested timezone and echoes it back', async () => {
      signedIn();
      mockGithub([1, 1]);

      const response = await GET(getRequest('?tz=America/New_York'));
      const body = (await response.json()) as RatioBody;

      expect(body.week.timezone).toBe('America/New_York');
      // Both ends carry the zone's offset, not UTC's.
      expect(body.week.start).toMatch(/-0[45]:00$/);
      expect(body.week.end).toMatch(/-0[45]:00$/);
    });

    it('defaults to UTC when no tz is given', async () => {
      signedIn();
      mockGithub([1, 1]);

      const response = await GET(getRequest());
      const body = (await response.json()) as RatioBody;

      expect(body.week.timezone).toBe('UTC');
      expect(body.week.start).toMatch(/\+00:00$/);
    });

    it('degrades an unrecognized tz to UTC rather than erroring', async () => {
      signedIn();
      mockGithub([1, 1]);

      const response = await GET(getRequest('?tz=Not/AZone'));
      const body = (await response.json()) as RatioBody;

      expect(response.status).toBe(200);
      expect(body.week.timezone).toBe('UTC');
    });
  });

  describe('failure modes', () => {
    it('returns 501 without a token, so the Dashboard can render nothing', async () => {
      signedIn();
      delete process.env.GITHUB_TOKEN;
      const requested = mockGithub([3, 6]);

      const response = await GET(getRequest());

      expect(response.status).toBe(501);
      expect(await response.json()).toStrictEqual({ error: 'PR ratio is not configured' });
      expect(requested).toHaveLength(0);
    });

    it('returns 501 with a single project — one repo is not a split', async () => {
      signedIn({ data: PROJECTS.slice(0, 1), error: null });
      const requested = mockGithub([3]);

      const response = await GET(getRequest());

      expect(response.status).toBe(501);
      expect(requested).toHaveLength(0);
    });

    it('returns 501 with no projects at all', async () => {
      signedIn({ data: [], error: null });

      const response = await GET(getRequest());

      expect(response.status).toBe(501);
    });

    it('maps a failed projects read to its status — never 501, which would hide the card', async () => {
      signedIn({ data: null, error: { message: 'connection refused' } });
      const requested = mockGithub([3, 6]);

      const response = await GET(getRequest());

      expect(response.status).toBe(500);
      expect(await response.json()).toStrictEqual({ error: 'connection refused' });
      expect(requested).toHaveLength(0);
    });

    it('returns 502 when a GitHub request fails', async () => {
      signedIn();
      mockGithub([0, 0], { ok: false });

      const response = await GET(getRequest());

      expect(response.status).toBe(502);
      expect(await response.json()).toStrictEqual({ error: 'GitHub request failed' });
    });

    it('never leaks the GitHub token into the response', async () => {
      signedIn();
      mockGithub([3, 6]);

      const response = await GET(getRequest());
      const body = await response.text();

      expect(body).not.toContain('ghp_test');
    });
  });
});
