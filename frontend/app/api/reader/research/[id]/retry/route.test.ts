/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { READER_POST_LIST_COLUMNS, type ReaderPostForResearch } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';
import { makeResearchPost } from '@/lib/reader/fixtures';
import { type ResearchConfig, getResearchConfig } from '@/lib/research/config';
import { fireResearchRoutine } from '@/lib/research/routine';
import { createClient } from '@/lib/supabase/server';

import { POST, maxDuration, runtime } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/research/config', () => ({ getResearchConfig: jest.fn() }));
jest.mock('@/lib/research/routine', () => ({ fireResearchRoutine: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockGetResearchConfig = jest.mocked(getResearchConfig);
const mockFire = jest.mocked(fireResearchRoutine);

pinClock('2026-09-29T12:00:00.000Z');

const CONFIG: ResearchConfig = {
  fireUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  fireToken: 'fire-token-secret',
  deliveryKey: 'delivery-key-secret',
};

const POST_ID = '7a1c2b3a-0000-4000-8000-00000000000a';
const BRIEF = 'Is a cold-climate heat pump worth it?\n\nCompare against the gas furnace.';
const SESSION = 'https://claude.ai/code/session_01Retry';

/** The post as the retry's read sees it: failed, one fire spent, nothing fired since. */
function stored(overrides: Partial<ReaderPostForResearch> = {}): ReaderPostForResearch {
  return {
    source: 'research',
    research_state: 'failed',
    created_at: '2026-09-29T09:00:00.000Z',
    research_fired_at: null,
    research_brief: BRIEF,
    research_attempts: 1,
    ...overrides,
  };
}

/** The list row the write answers with, as recorded by the fire. */
function written(overrides: Record<string, unknown> = {}) {
  const {
    text: _text,
    html: _html,
    research_brief: _brief,
    ...row
  } = makeResearchPost({
    id: POST_ID,
    research_brief: BRIEF,
    research_state: 'researching',
    research_attempts: 2,
    research_session_url: SESSION,
  });
  return { ...row, ...overrides };
}

/**
 * A signed-in client whose `reader_posts` answers are, in order: the retry's look at the post, the
 * claim (the post as read, or `null` when another request claimed it first), and the recorded
 * fire's read-back.
 */
function signedIn(
  post: ReaderPostForResearch | null = stored(),
  saved?: { data: unknown; error?: { message: string; code?: string } },
  readError?: { message: string; code?: string },
  claim?: { data: unknown; error?: { message: string; code?: string } },
) {
  const supabase = makeSupabaseDouble({});
  supabase
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: post, error: readError })
    .mockResolvedValueOnce(claim ?? { data: { id: POST_ID } })
    .mockResolvedValueOnce(saved ?? { data: written() });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function retry(id: string = POST_ID): Promise<Response> {
  return POST(new Request(`http://localhost/api/reader/research/${id}/retry`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  mockGetResearchConfig.mockReturnValue(CONFIG);
  mockFire.mockResolvedValue({ ok: true, sessionUrl: SESSION });
});

describe('route configuration', () => {
  it('runs on Node, with room for one ten-second fire', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(30);
  });
});

describe('POST /api/reader/research/[id]/retry', () => {
  it('answers 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await retry();

    expect(response.status).toBe(401);
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('answers 501 when research is not configured, before reading anything', async () => {
    mockGetResearchConfig.mockReturnValue(undefined);
    const supabase = signedIn();

    const response = await retry();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Research is not configured on this deployment',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a UUID, without reading', async () => {
    const supabase = signedIn();

    const response = await retry('nope');

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('answers 404 when there is no such post', async () => {
    signedIn(null);

    const response = await retry();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Post not found' });
    expect(mockFire).not.toHaveBeenCalled();
  });

  it.each(['gmail', 'instapaper'])(
    'answers 404 for a %s post — only research posts retry',
    async (source) => {
      signedIn(stored({ source, research_state: null, research_brief: null }));

      const response = await retry();

      expect(response.status).toBe(404);
      expect(mockFire).not.toHaveBeenCalled();
    },
  );

  it('reads the post by id, selecting only what the phase and the fire need', async () => {
    const supabase = signedIn();

    await retry();

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'reader_posts');
    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).toEqual([
      'source',
      'research_state',
      'created_at',
      'research_fired_at',
      'research_brief',
      'research_attempts',
    ]);
    expect(supabase.table('reader_posts').eq).toHaveBeenNthCalledWith(1, 'id', POST_ID);
  });

  it('maps a failed read and fires nothing', async () => {
    signedIn(null, { data: null }, { message: 'permission denied', code: '42501' });

    const response = await retry();

    expect(response.status).toBe(500);
    expect(mockFire).not.toHaveBeenCalled();
  });

  describe('409 unless the post is failed or stalled', () => {
    it.each([
      [
        'freshly queued',
        stored({ research_state: 'queued', created_at: '2026-09-29T11:55:00.000Z' }),
      ],
      [
        'queued for exactly ten minutes',
        stored({ research_state: 'queued', created_at: '2026-09-29T11:50:00.000Z' }),
      ],
      [
        'researching',
        stored({ research_state: 'researching', research_fired_at: '2026-09-29T11:00:00.000Z' }),
      ],
      [
        'researching for exactly three hours',
        stored({ research_state: 'researching', research_fired_at: '2026-09-29T09:00:00.000Z' }),
      ],
      ['done', stored({ research_state: 'done' })],
    ])('refuses a post that is %s, and fires and writes nothing', async (_label, post) => {
      const supabase = signedIn(post);

      const response = await retry();

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'Only a failed or stalled research post can be retried',
      });
      expect(mockFire).not.toHaveBeenCalled();
      expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
    });

    it.each([
      ['failed', stored({ research_state: 'failed' })],
      [
        'queued for over ten minutes — the fire never happened',
        stored({ research_state: 'queued', created_at: '2026-09-29T11:49:59.000Z' }),
      ],
      [
        'researching for over three hours — the session never reported back',
        stored({ research_state: 'researching', research_fired_at: '2026-09-29T08:59:59.000Z' }),
      ],
    ])('retries a post that is %s', async (_label, post) => {
      signedIn(post);

      const response = await retry();

      expect(response.status).toBe(200);
      expect(mockFire).toHaveBeenCalledTimes(1);
    });

    it('answers 409 for a research post with no brief to send — a state the database refuses to store', async () => {
      const supabase = signedIn(stored({ research_brief: null }));

      const response = await retry();

      expect(response.status).toBe(409);
      expect(mockFire).not.toHaveBeenCalled();
      expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
    });
  });

  describe('a retry', () => {
    it('claims the post as read — one more attempt — then fires once with its brief and records it', async () => {
      const supabase = signedIn(stored({ research_attempts: 3 }));

      await retry();

      const table = supabase.table('reader_posts');
      expect(table.update).toHaveBeenNthCalledWith(1, { research_attempts: 4 });
      expect(table.eq).toHaveBeenCalledWith('research_attempts', 3);
      expect(table.eq).toHaveBeenCalledWith('research_state', 'failed');
      expect(mockFire).toHaveBeenCalledTimes(1);
      expect(mockFire).toHaveBeenCalledWith(CONFIG, { id: POST_ID, research_brief: BRIEF });
      expect(table.update).toHaveBeenNthCalledWith(2, {
        research_state: 'researching',
        research_fired_at: '2026-09-29T12:00:00.000Z',
        research_session_url: SESSION,
        research_error: null,
      });
      expect(table.eq).toHaveBeenLastCalledWith('id', POST_ID);
    });

    it('answers 409 and fires nothing when another request claimed the post first', async () => {
      const supabase = signedIn(stored(), undefined, undefined, { data: null });

      const response = await retry();

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'This research is already being retried',
      });
      expect(mockFire).not.toHaveBeenCalled();
      expect(supabase.table('reader_posts').update).toHaveBeenCalledTimes(1);
    });

    it('answers through the shared error mapping, firing nothing, when the claim cannot be written', async () => {
      signedIn(stored(), undefined, undefined, {
        data: null,
        error: { message: 'connection reset', code: 'XX000' },
      });

      const response = await retry();

      expect(response.status).toBe(500);
      expect(mockFire).not.toHaveBeenCalled();
    });

    it('answers the list-shaped row the write read back — never the brief or a body', async () => {
      const row = written();
      const supabase = signedIn(stored(), { data: row });

      const response = await retry();

      const raw = await response.text();
      expect(JSON.parse(raw)).toEqual(row);
      expect(raw).not.toContain('Compare against the gas furnace');
      expect(supabase.table('reader_posts').select).toHaveBeenLastCalledWith(
        READER_POST_LIST_COLUMNS,
      );
      const body = JSON.parse(raw) as Record<string, unknown>;
      expect(body).not.toHaveProperty('research_brief');
      expect(body).not.toHaveProperty('text');
      expect(body).not.toHaveProperty('html');
    });

    it('records a refused fire as failed, and still answers 200 with that row', async () => {
      const error = 'the Routine’s daily run cap or usage limit was reached';
      mockFire.mockResolvedValue({ ok: false, error });
      const row = written({ research_state: 'failed', research_error: error });
      const supabase = signedIn(stored(), { data: row });

      const response = await retry();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(row);
      expect(supabase.table('reader_posts').update).toHaveBeenLastCalledWith({
        research_state: 'failed',
        research_error: error,
      });
    });

    it('answers 409 if the report arrived (or the post went) while the fire was in flight', async () => {
      signedIn(stored(), { data: null });

      const response = await retry();

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'The report arrived while retrying — reload to read it',
      });
    });

    it('answers through the shared error mapping when the outcome cannot be recorded', async () => {
      // The post is exactly as it was — still failed or stalled — so the row still offers Retry.
      signedIn(stored(), { data: null, error: { message: 'connection reset', code: 'XX000' } });

      const response = await retry();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'connection reset' });
    });
  });
});
