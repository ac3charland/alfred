/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type SupabaseDouble,
  type TableStub,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

// The data helpers live in the server-only read layer.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const LEDGER_KEY = 'ledger-key-xyz';
const INGEST_KEY = 'ingest-key-abc';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const PROJECT = {
  id: PROJECT_ID,
  key: 'ALF',
  name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
};
const STORY = {
  ref: 'ALF-9',
  title: 'A fixture story',
  notes: 'Invented ticket notes.',
  project_id: PROJECT_ID,
  spec_path: 'docs/specs/ALF-9.html',
  spec_sha: 'c'.repeat(40),
};
const EPIC = { ref: 'ALF-4', name: 'Bug Fixes', notes: null, project_id: PROJECT_ID };

function tables(project: unknown = PROJECT): Record<string, TableStub> {
  return {
    projects: { maybeSingle: { data: project } },
    v_code_stories: { list: { data: [STORY] } },
    epics: { list: { data: [EPIC] } },
  };
}

function getRequest(query: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/code/ledger-inputs${query}`, { headers });
}

function keyed(stubs: Record<string, TableStub> = tables()): SupabaseDouble {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
  const admin = makeSupabaseDouble(stubs);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

const withKey = { authorization: `Bearer ${LEDGER_KEY}` };

describe('GET /api/code/ledger-inputs', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env.LEDGER_API_KEY = LEDGER_KEY;
    process.env.INGEST_API_KEY = INGEST_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  describe('auth', () => {
    it('reads through the admin client for the ledger key', async () => {
      const admin = keyed();

      const response = await GET(getRequest('?repo=ac3charland/alfred', withKey));

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('projects');
    });

    it('reads through the session client for the signed-in owner', async () => {
      const session = makeSupabaseDouble(tables());
      mockCreateClient.mockResolvedValue(session as never);

      const response = await GET(getRequest('?repo=ac3charland/alfred'));

      expect(response.status).toBe(200);
      expect(session.from).toHaveBeenCalledWith('projects');
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it.each([
      ['the ingest key', { authorization: `Bearer ${INGEST_KEY}` }],
      ['the ingest key as x-api-key', { 'x-api-key': INGEST_KEY }],
      ['a wrong key', { authorization: 'Bearer nope' }],
      ['no auth at all', {}],
    ])('rejects %s with 401 and reads nothing', async (_label, headers) => {
      const admin = keyed();

      const response = await GET(getRequest('?repo=ac3charland/alfred', headers));

      expect(response.status).toBe(401);
      expect(admin.from).not.toHaveBeenCalled();
    });
  });

  it('answers the matching project, its stories (with notes) and its epics', async () => {
    const admin = keyed();

    const response = await GET(getRequest('?repo=ac3charland/alfred', withKey));

    expect(await response.json()).toStrictEqual({
      project: PROJECT,
      stories: [STORY],
      epics: [EPIC],
    });
    expect(admin.table('projects').eq).toHaveBeenCalledWith('repo_owner', 'ac3charland');
    expect(admin.table('projects').eq).toHaveBeenCalledWith('repo_name', 'alfred');
    expect(admin.table('v_code_stories').eq).toHaveBeenCalledWith('project_id', PROJECT_ID);
    expect(admin.table('epics').eq).toHaveBeenCalledWith('project_id', PROJECT_ID);
  });

  it('leaves the spec snapshots out, keeping the payload small — git holds every spec', async () => {
    const admin = keyed();

    await GET(getRequest('?repo=ac3charland/alfred', withKey));

    const [storyColumns] = admin.table('v_code_stories').select.mock.calls[0] as [string];
    const [epicColumns] = admin.table('epics').select.mock.calls[0] as [string];
    expect(storyColumns).toContain('notes');
    expect(storyColumns).toContain('epic_spec_path');
    expect(storyColumns).not.toContain('spec_markdown');
    expect(epicColumns).toContain('spec_path');
    expect(epicColumns).not.toContain('spec_markdown');
  });

  it('404s for a repo no project names', async () => {
    keyed(tables(null));

    const response = await GET(getRequest('?repo=someone/else', withKey));

    expect(response.status).toBe(404);
  });

  it.each(['', '?repo=', '?repo=alfred', '?repo=a/b/c', '?repo=/alfred', '?repo=owner/'])(
    '400s for a missing or malformed repo (%s)',
    async (query) => {
      const admin = keyed();

      const response = await GET(getRequest(query, withKey));

      expect(response.status).toBe(400);
      expect(admin.from).not.toHaveBeenCalled();
    },
  );

  it('maps a failed read to its status', async () => {
    keyed({
      ...tables(),
      v_code_stories: { list: { data: null, error: { message: 'connection refused' } } },
    });

    const response = await GET(getRequest('?repo=ac3charland/alfred', withKey));

    expect(response.status).toBe(500);
  });
});
