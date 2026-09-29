/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type MockResult,
  makeChain,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { READER_POST_LIST_COLUMNS } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';
import { makeResearchPost } from '@/lib/reader/fixtures';
import { type ResearchConfig, getResearchConfig } from '@/lib/research/config';
import { type ResearchFireOutcome, fireResearchRoutine } from '@/lib/research/routine';
import { createClient } from '@/lib/supabase/server';
import type { ReaderPost } from '@/lib/types';

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

const ID_A = '6f1c2b3a-0000-4000-8000-00000000000a';
const ID_B = '6f1c2b3a-0000-4000-8000-00000000000b';
const ID_C = '6f1c2b3a-0000-4000-8000-00000000000c';
const POST_A = '7a1c2b3a-0000-4000-8000-00000000000a';
const POST_B = '7a1c2b3a-0000-4000-8000-00000000000b';

/** An item as the route's read answers it: only the shape the checks need. */
interface StoredItem {
  id: string;
  title: string;
  item_type: string;
  parent_id: string | null;
  dispatched_at: string | null;
}

function stored(id: string, overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id,
    title: `Question ${id.slice(-1)}`,
    item_type: 'research',
    parent_id: null,
    dispatched_at: null,
    ...overrides,
  };
}

/** A post as `send_items_to_research` returns it: queued, brief set, no body, never fired. */
function created(id: string, brief: string): ReaderPost {
  return makeResearchPost({
    id,
    title: brief.split('\n', 1)[0] ?? brief,
    research_brief: brief,
    research_state: 'queued',
    research_attempts: 0,
    research_fired_at: null,
    research_session_url: null,
  });
}

/** A created post through the list columns — what the store holds, with no brief or bodies. */
function listRow(post: ReaderPost, overrides: Record<string, unknown> = {}) {
  const { text: _text, html: _html, research_brief: _brief, ...row } = post;
  return { ...row, ...overrides };
}

const BRIEF_A = 'Is a cold-climate heat pump worth it?\n\nCompare against the gas furnace.';
const BRIEF_B = 'What is the evidence on spaced repetition?';

const SESSION_A = 'https://claude.ai/code/session_01A';
const SESSION_B = 'https://claude.ai/code/session_01B';

/**
 * A signed-in client whose two `items` reads answer in order (the rows by id, then their children),
 * whose `rpc` answers with the created posts, and whose `reader_posts` patches answer with
 * `patched`, one per post in order.
 */
function signedIn({
  rows = [stored(ID_A), stored(ID_B)],
  children = [],
  rowsError,
  childrenError,
  rpc = { data: [created(POST_A, BRIEF_A), created(POST_B, BRIEF_B)] },
  patched = [],
}: {
  rows?: StoredItem[];
  children?: { parent_id: string }[];
  rowsError?: MockResult['error'];
  childrenError?: MockResult['error'];
  rpc?: MockResult;
  patched?: MockResult[];
} = {}) {
  const rowsChain = makeChain({ list: { data: rows, error: rowsError } });
  const childrenChain = makeChain({ list: { data: children, error: childrenError } });
  const supabase = makeSupabaseDouble({}, rpc);
  supabase.from.mockReturnValueOnce(rowsChain).mockReturnValueOnce(childrenChain);
  for (const result of patched)
    supabase.table('reader_posts').maybeSingle.mockResolvedValueOnce(result);
  mockCreateClient.mockResolvedValue(supabase as never);
  return { supabase, rowsChain, childrenChain };
}

/** What the patch write answers once the fire's outcome is recorded. */
function recorded(post: ReaderPost, overrides: Record<string, unknown>): MockResult {
  return { data: listRow(post, overrides), error: undefined };
}

function send(body: unknown): Request {
  return new Request('http://localhost/api/reader/research', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

/** Every console method's arguments, flattened to one searchable string. */
function everythingLogged(spies: jest.SpiedFunction<(...args: unknown[]) => void>[]): string {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

function acceptFires(): void {
  mockFire.mockImplementation((_config, post) =>
    Promise.resolve<ResearchFireOutcome>({
      ok: true,
      sessionUrl: post.id === POST_A ? SESSION_A : SESSION_B,
    }),
  );
}

beforeEach(() => {
  mockGetResearchConfig.mockReturnValue(CONFIG);
  acceptFires();
});

describe('route configuration', () => {
  it('runs on Node for up to a minute — five sequential fires at ten seconds each fit', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });
});

describe('POST /api/reader/research', () => {
  it('answers 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(401);
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('answers 501 when research is not configured, before reading or firing anything', async () => {
    mockGetResearchConfig.mockReturnValue(undefined);
    const { supabase } = signedIn();

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Research is not configured on this deployment',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it.each([
    ['no ids', { ids: [] }],
    ['a non-uuid id', { ids: ['not-a-uuid'] }],
    ['an unknown field', { ids: [ID_A], extra: true }],
    ['more than five ids', { ids: Array.from({ length: 6 }, () => ID_A) }],
    ['no body fields', {}],
  ])('refuses %s with 400 and reads nothing', async (_label, body) => {
    const { supabase } = signedIn();

    const response = await POST(send(body), STUB_CONTEXT);

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('reads the items by id and their children by parent, selecting only what it checks', async () => {
    const { supabase, rowsChain, childrenChain } = signedIn();

    await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'items');
    expect(supabase.from).toHaveBeenNthCalledWith(2, 'items');
    expect(rowsChain.select).toHaveBeenCalledWith('id,title,item_type,parent_id,dispatched_at');
    expect(rowsChain.in).toHaveBeenCalledWith('id', [ID_A, ID_B]);
    expect(childrenChain.select).toHaveBeenCalledWith('parent_id');
    expect(childrenChain.in).toHaveBeenCalledWith('parent_id', [ID_A, ID_B]);
  });

  describe('a valid dispatch', () => {
    it('consumes the items through the RPC, then fires once per created post, and answers the patched rows', async () => {
      const postA = created(POST_A, BRIEF_A);
      const postB = created(POST_B, BRIEF_B);
      const rowA = recorded(postA, {
        research_state: 'researching',
        research_fired_at: '2026-09-29T12:00:00.000Z',
        research_session_url: SESSION_A,
        research_attempts: 1,
      });
      const rowB = recorded(postB, {
        research_state: 'researching',
        research_fired_at: '2026-09-29T12:00:00.000Z',
        research_session_url: SESSION_B,
        research_attempts: 1,
      });
      const { supabase } = signedIn({
        rpc: { data: [postA, postB] },
        patched: [rowA, rowB],
      });

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ posts: [rowA.data, rowB.data] });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith('send_items_to_research', { p_ids: [ID_A, ID_B] });
      expect(mockFire).toHaveBeenCalledTimes(2);
      expect(mockFire).toHaveBeenNthCalledWith(1, CONFIG, { id: POST_A, research_brief: BRIEF_A });
      expect(mockFire).toHaveBeenNthCalledWith(2, CONFIG, { id: POST_B, research_brief: BRIEF_B });
    });

    it('fires only after the RPC, one post at a time — each fire recorded before the next starts', async () => {
      const { supabase } = signedIn({
        patched: [recorded(created(POST_A, BRIEF_A), {}), recorded(created(POST_B, BRIEF_B), {})],
      });

      await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      const [rpcOrder = 0] = supabase.rpc.mock.invocationCallOrder;
      const [fireOne = 0, fireTwo = 0] = mockFire.mock.invocationCallOrder;
      const [writeOne = 0, writeTwo = 0] =
        supabase.table('reader_posts').update.mock.invocationCallOrder;
      expect(rpcOrder).toBeLessThan(fireOne);
      expect(fireOne).toBeLessThan(writeOne);
      expect(writeOne).toBeLessThan(fireTwo);
      expect(fireTwo).toBeLessThan(writeTwo);
    });

    it('records an accepted fire on each post: researching, the moment, the session link, one attempt', async () => {
      const { supabase } = signedIn({
        patched: [recorded(created(POST_A, BRIEF_A), {}), recorded(created(POST_B, BRIEF_B), {})],
      });

      await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      const table = supabase.table('reader_posts');
      expect(table.update).toHaveBeenNthCalledWith(1, {
        research_state: 'researching',
        research_fired_at: '2026-09-29T12:00:00.000Z',
        research_session_url: SESSION_A,
        research_error: null,
        research_attempts: 1,
      });
      expect(table.update).toHaveBeenNthCalledWith(2, {
        research_state: 'researching',
        research_fired_at: '2026-09-29T12:00:00.000Z',
        research_session_url: SESSION_B,
        research_error: null,
        research_attempts: 1,
      });
      expect(table.eq).toHaveBeenNthCalledWith(1, 'id', POST_A);
      expect(table.eq).toHaveBeenNthCalledWith(2, 'id', POST_B);
      expect(table.select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
    });

    it('records a fire that carried no session link as a null link', async () => {
      mockFire.mockResolvedValue({ ok: true, sessionUrl: null });
      const { supabase } = signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [created(POST_A, BRIEF_A)] },
        patched: [recorded(created(POST_A, BRIEF_A), {})],
      });

      await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

      expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
        expect.objectContaining({ research_state: 'researching', research_session_url: null }),
      );
    });

    it('sends a repeated id once', async () => {
      const { supabase } = signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [created(POST_A, BRIEF_A)] },
        patched: [recorded(created(POST_A, BRIEF_A), {})],
      });

      const response = await POST(send({ ids: [ID_A, ID_A] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      expect(supabase.rpc).toHaveBeenCalledWith('send_items_to_research', { p_ids: [ID_A] });
      expect(mockFire).toHaveBeenCalledTimes(1);
    });

    it('never answers the brief, the report text or the HTML — only the list columns', async () => {
      const post = { ...created(POST_A, BRIEF_A), text: 'BODY TEXT', html: '<p>BODY HTML</p>' };
      signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [post] },
        // A patch write that failed hands back the created post, which does carry those fields.
        patched: [{ data: null, error: { message: 'boom' } }],
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

      const raw = await response.text();
      expect(raw).not.toContain('BODY TEXT');
      expect(raw).not.toContain('BODY HTML');
      expect(raw).not.toContain('Compare against the gas furnace');
      const [row] = (JSON.parse(raw) as { posts: Record<string, unknown>[] }).posts;
      expect(row).not.toHaveProperty('text');
      expect(row).not.toHaveProperty('html');
      expect(row).not.toHaveProperty('research_brief');
    });
  });

  describe('a fire that fails is not a request failure', () => {
    it.each([
      ["the research Routine refused alfred's token"],
      ["the Routine's daily run cap or usage limit was reached"],
      ['the research Routine answered HTTP 500'],
      ["the research Routine couldn't be reached"],
    ])('records "%s" on the post and answers 200 with it', async (error) => {
      mockFire.mockResolvedValue({ ok: false, error });
      const post = created(POST_A, BRIEF_A);
      const row = recorded(post, { research_state: 'failed', research_error: error });
      const { supabase } = signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [post] },
        patched: [row],
      });

      const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ posts: [row.data] });
      // The fire's session link and time are left out: nothing was started.
      expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
        research_state: 'failed',
        research_error: error,
        research_attempts: 1,
      });
    });

    it('still fires the posts after it — one refusal takes out one question', async () => {
      mockFire
        .mockResolvedValueOnce({ ok: false, error: 'the research Routine answered HTTP 503' })
        .mockResolvedValueOnce({ ok: true, sessionUrl: SESSION_B });
      const { supabase } = signedIn({
        patched: [
          recorded(created(POST_A, BRIEF_A), { research_state: 'failed' }),
          recorded(created(POST_B, BRIEF_B), { research_state: 'researching' }),
        ],
      });

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      expect(mockFire).toHaveBeenCalledTimes(2);
      expect(supabase.table('reader_posts').update).toHaveBeenCalledTimes(2);
      const body = (await response.json()) as { posts: { research_state: string }[] };
      expect(body.posts.map((post) => post.research_state)).toEqual(['failed', 'researching']);
    });
  });

  describe('a patch write that fails after the fire', () => {
    it('logs it and still answers 200 — the items are gone either way — with the post as created', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const postA = created(POST_A, BRIEF_A);
      signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [postA] },
        patched: [{ data: null, error: { message: 'connection reset' } }],
      });

      const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      // The row is handed back as the RPC left it, queued: it reads as stale after ten minutes,
      // and the row then offers Retry. The session that was started delivers to it regardless.
      await expect(response.json()).resolves.toEqual({ posts: [listRow(postA)] });
      expect(error).toHaveBeenCalledTimes(1);
      expect(everythingLogged([error])).toContain(POST_A);
    });

    it('treats a patch that matched no row the same way', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const postA = created(POST_A, BRIEF_A);
      signedIn({
        rows: [stored(ID_A)],
        rpc: { data: [postA] },
        patched: [{ data: null, error: undefined }],
      });

      const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { posts: { id: string; research_state: string }[] };
      expect(body.posts).toHaveLength(1);
      expect(body.posts[0]).toMatchObject({ id: POST_A, research_state: 'queued' });
    });

    it('carries on to the next post after one that could not be recorded', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      signedIn({
        patched: [
          { data: null, error: { message: 'boom' } },
          recorded(created(POST_B, BRIEF_B), { research_state: 'researching' }),
        ],
      });

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(200);
      expect(mockFire).toHaveBeenCalledTimes(2);
      const body = (await response.json()) as { posts: { research_state: string }[] };
      expect(body.posts.map((post) => post.research_state)).toEqual(['queued', 'researching']);
    });
  });

  it('answers 404 naming an id that is not there, and consumes and fires nothing', async () => {
    const { supabase } = signedIn({ rows: [stored(ID_A)] });

    const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: `Item ${ID_B} not found` });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  describe('409 — an item research cannot take', () => {
    it.each([
      ['is not a research item', stored(ID_B, { item_type: 'task' }), [], 'is not a research item'],
      [
        'is a knowledge item',
        stored(ID_B, { item_type: 'knowledge' }),
        [],
        'is not a research item',
      ],
      ['is a subtask', stored(ID_B, { parent_id: ID_C }), [], 'is a subtask'],
      [
        'has already been dispatched',
        stored(ID_B, { dispatched_at: '2026-09-28T10:00:00Z' }),
        [],
        'has already been dispatched',
      ],
      ['has subtasks', stored(ID_B), [{ parent_id: ID_B }], 'has subtasks'],
      [
        'has subtasks and was dispatched — the shape fault is named first',
        stored(ID_B, { dispatched_at: '2026-09-28T10:00:00Z' }),
        [{ parent_id: ID_B }],
        'has subtasks',
      ],
    ])('refuses an item that %s, naming it', async (_label, bad, children, reason) => {
      const { supabase } = signedIn({ rows: [stored(ID_A), bad], children });

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: `Item ${ID_B} ${reason}` });
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(mockFire).not.toHaveBeenCalled();
    });

    it('names the FIRST bad id in the request’s order', async () => {
      signedIn({
        rows: [
          stored(ID_A),
          stored(ID_B, { item_type: 'code' }),
          stored(ID_C, { item_type: 'task' }),
        ],
      });

      const response = await POST(send({ ids: [ID_C, ID_B, ID_A] }), STUB_CONTEXT);

      await expect(response.json()).resolves.toEqual({
        error: `Item ${ID_C} is not a research item`,
      });
    });
  });

  it('maps a failed RPC through the shared error mapping, and fires nothing', async () => {
    signedIn({ rpc: { data: null, error: { message: 'boom', code: '23514' } } });

    const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('maps a failed items read and consumes nothing', async () => {
    const { supabase } = signedIn({
      rowsError: { message: 'permission denied', code: '42501' },
    });

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('maps a failed children read and consumes nothing', async () => {
    const { supabase } = signedIn({
      childrenError: { message: 'permission denied', code: '42501' },
    });

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('never logs the fire token or a brief', async () => {
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'info').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    // A constraint violation's `details` quotes the failing row, brief included.
    const quotingRow = {
      message: 'new row violates check constraint',
      code: '23514',
      details: `Failing row contains (${BRIEF_A}, ${BRIEF_B}).`,
    };
    signedIn({
      patched: [
        { data: null, error: quotingRow },
        { data: null, error: quotingRow },
      ],
    });

    await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    const logged = everythingLogged(logs);
    // Something WAS logged — the failed writes — so this is not vacuously clean.
    expect(logged).toContain(POST_A);
    expect(logged).toContain('23514');
    expect(logged).not.toContain(CONFIG.fireToken);
    expect(logged).not.toContain('cold-climate');
    expect(logged).not.toContain('spaced repetition');
  });
});
