/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { type SupabaseDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { renderReportHtml } from '@/lib/reader/report-html';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { PUT, runtime } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
// The unified packages are pure ESM, which Jest leaves untransformed, so the renderer is stubbed
// here; its own suite runs the real pipeline. What this route owes it is the report, unchanged.
jest.mock('@/lib/reader/report-html', () => ({ renderReportHtml: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);
const mockRender = jest.mocked(renderReportHtml);

pinClock('2026-09-29T12:00:00.000Z');

const KEY = 'delivery-key-0123456789abcdef';
const POST_ID = '7a1c2b3a-0000-4000-8000-00000000000a';

const CONFIGURED = {
  RESEARCH_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  RESEARCH_ROUTINE_FIRE_TOKEN: 'fire-token',
  RESEARCH_DELIVERY_KEY: KEY,
} as const;

const originalEnvironment = { ...process.env };

/** Exactly the research vars the case declares, so an ambient value can't make a case pass. */
function withEnvironment(values: Partial<Record<string, string>>): void {
  process.env = Object.fromEntries(
    Object.entries(originalEnvironment).filter(
      ([name]) => !name.startsWith('RESEARCH_') && name !== 'INGEST_API_KEY',
    ),
  ) as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

const REPORT = '# Is a heat pump worth it?\n\n## Bottom line\n\nProbably yes.  \n';
const REPORT_HTML = '<h1>Is a heat pump worth it?</h1>';

interface Stored {
  source: string;
  research_state: string | null;
}

/**
 * An admin client whose first `reader_posts` read is the route's look at the post and whose second
 * answer is the guarded UPDATE's: the row it matched, or none when the guard held.
 */
function adminSees(
  post: Stored | null,
  written?: { data: { id: string } | null; error?: { message: string; code?: string } },
  readError?: { message: string; code?: string },
): SupabaseDouble {
  const admin = makeSupabaseDouble({});
  admin
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: post, error: readError })
    .mockResolvedValueOnce(written ?? { data: { id: POST_ID } });
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

function deliver(body: unknown, headers?: Record<string, string>, id = POST_ID): Promise<Response> {
  const request = new Request(`http://localhost/api/reader/research/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? { authorization: `Bearer ${KEY}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  withEnvironment(CONFIGURED);
  mockRender.mockReturnValue(REPORT_HTML);
});

afterAll(() => {
  process.env = originalEnvironment;
});

describe('route configuration', () => {
  it('runs on Node, for the constant-time key comparison', () => {
    expect(runtime).toBe('nodejs');
  });
});

describe('PUT /api/reader/research/[id] — the key', () => {
  it.each([
    ['no credential', {}],
    ['a wrong bearer token', { authorization: 'Bearer nope' }],
    ['a wrong x-api-key', { 'x-api-key': 'nope' }],
  ])(
    'answers 401 for %s, before reading the body or touching the database',
    async (_label, headers) => {
      const admin = adminSees({ source: 'research', research_state: 'researching' });

      const response = await deliver({ report: REPORT }, headers);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
      expect(admin.from).not.toHaveBeenCalled();
      expect(mockRender).not.toHaveBeenCalled();
    },
  );

  it('answers 401 even for a malformed body when the key is wrong — nothing is revealed', async () => {
    const response = await deliver('not json', { authorization: 'Bearer nope' });

    expect(response.status).toBe(401);
  });

  it('accepts the key as a bearer token', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: REPORT }, { authorization: `Bearer ${KEY}` });

    expect(response.status).toBe(200);
  });

  it('accepts the key in x-api-key', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: REPORT }, { 'x-api-key': KEY });

    expect(response.status).toBe(200);
  });

  it('never accepts the ingest key', async () => {
    process.env.INGEST_API_KEY = 'ingest-key-abcdef';
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    const bearer = await deliver({ report: REPORT }, { authorization: 'Bearer ingest-key-abcdef' });
    const header = await deliver({ report: REPORT }, { 'x-api-key': 'ingest-key-abcdef' });

    expect(bearer.status).toBe(401);
    expect(header.status).toBe(401);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('answers 401 when research is not configured, whatever key is sent', async () => {
    withEnvironment({ RESEARCH_DELIVERY_KEY: KEY });
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(401);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('needs no session — it is authenticated by the key alone', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/reader/research/[id] — the body', () => {
  it.each([
    ['not JSON', 'this is not json'],
    ['an empty body', ''],
    ['JSON that is not an object', '"a report"'],
    ['no report', {}],
    ['a report that is not a string', { report: 42 }],
    ['a null report', { report: null }],
    ['an empty report', { report: '' }],
    ['a report of only whitespace', { report: '  \n\t  ' }],
    ['a report over 200 000 characters', { report: 'a'.repeat(200_001) }],
  ])('answers 422 for %s, and touches nothing', async (_label, body) => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver(body);

    expect(response.status).toBe(422);
    const answer = (await response.json()) as { error: string };
    expect(typeof answer.error).toBe('string');
    expect(admin.from).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('says why: an unparseable body and a bad report are told apart', async () => {
    adminSees(null);

    const notJson = await deliver('nope');
    const blank = await deliver({ report: '  ' });

    await expect(notJson.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    const blankBody = (await blank.json()) as { error: string; details: unknown[] };
    expect(blankBody.error).toBe('Invalid report');
    expect(blankBody.details).toEqual([expect.objectContaining({ path: ['report'] })]);
  });

  it('accepts a report of exactly 200 000 characters', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: 'a'.repeat(200_000) });

    expect(response.status).toBe(200);
  });

  it('answers 422 for a bad body before it answers 404 for a missing post', async () => {
    adminSees(null);

    const response = await deliver({ report: '' });

    expect(response.status).toBe(422);
  });
});

describe('PUT /api/reader/research/[id] — the post', () => {
  it('answers 404 when there is no post with that id', async () => {
    const admin = adminSees(null);

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Post not found' });
    expect(admin.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it.each(['gmail', 'instapaper'])(
    'answers 404 for a %s post — only research posts take a report',
    async (source) => {
      const admin = adminSees({ source, research_state: null });

      const response = await deliver({ report: REPORT });

      expect(response.status).toBe(404);
      expect(admin.table('reader_posts').update).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for an id that is not a UUID, without querying', async () => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: REPORT }, { authorization: `Bearer ${KEY}` }, 'nope');

    expect(response.status).toBe(404);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('answers 409 "already delivered" for a post whose report has arrived, and writes nothing', async () => {
    const admin = adminSees({ source: 'research', research_state: 'done' });

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'already delivered' });
    expect(admin.table('reader_posts').update).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it.each(['queued', 'researching', 'failed'])(
    'accepts a report for a %s post — a late report is welcome',
    async (research_state) => {
      adminSees({ source: 'research', research_state });

      const response = await deliver({ report: REPORT });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: POST_ID });
    },
  );

  it('reads the post by id, selecting only its kind and state', async () => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    expect(admin.from).toHaveBeenNthCalledWith(1, 'reader_posts');
    expect(admin.table('reader_posts').select).toHaveBeenNthCalledWith(1, 'source,research_state');
    expect(admin.table('reader_posts').eq).toHaveBeenNthCalledWith(1, 'id', POST_ID);
  });

  it('does not ask whether the post is archived — a report delivered to an archived post lands in the archive', async () => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    const table = admin.table('reader_posts');
    const filters = [table.eq.mock.calls, table.neq.mock.calls] as unknown[][][];
    expect(filters.flat().map(([column]) => column)).not.toContain('archived_at');
  });
});

describe('PUT /api/reader/research/[id] — the write', () => {
  it('lands the report in ONE update: text, rendered html, word count, delivered, summary reset', async () => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    expect(admin.table('reader_posts').update).toHaveBeenCalledTimes(1);
    expect(admin.table('reader_posts').update).toHaveBeenCalledWith({
      // Stored as sent — the trailing whitespace is the session's, not the route's to trim.
      text: REPORT,
      html: REPORT_HTML,
      word_count: 12,
      html_extracted: false,
      research_state: 'done',
      research_delivered_at: '2026-09-29T12:00:00.000Z',
      received_at: '2026-09-29T12:00:00.000Z',
      research_error: null,
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      summarizing_since: null,
      headline: null,
      gist: null,
      overview: null,
      model: null,
      prompt_version: null,
      summarized_at: null,
    });
  });

  it('renders the report exactly as sent', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledWith(REPORT);
  });

  it('guards the update in its WHERE clause: this post, a research post, not already delivered', async () => {
    const admin = adminSees({ source: 'research', research_state: 'researching' });

    await deliver({ report: REPORT });

    const table = admin.table('reader_posts');
    expect(table.eq).toHaveBeenCalledWith('id', POST_ID);
    expect(table.eq).toHaveBeenCalledWith('source', 'research');
    expect(table.neq).toHaveBeenCalledWith('research_state', 'done');
  });

  it('answers 409 when the guard matched no row — a racing delivery got there first', async () => {
    adminSees({ source: 'research', research_state: 'researching' }, { data: null });

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'already delivered' });
  });

  it('answers only the id — the report is never echoed', async () => {
    adminSees({ source: 'research', research_state: 'researching' });

    const response = await deliver({ report: REPORT });

    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({ id: POST_ID });
    expect(raw).not.toContain('Bottom line');
  });

  it('maps a failed read through the shared error mapping, and writes nothing', async () => {
    const admin = adminSees(null, { data: null }, { message: 'permission denied', code: '42501' });

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(500);
    expect(admin.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('maps a failed write through the shared error mapping', async () => {
    adminSees(
      { source: 'research', research_state: 'researching' },
      { data: null, error: { message: 'boom', code: 'XX000' } },
    );

    const response = await deliver({ report: REPORT });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });
});
