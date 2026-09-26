/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type MockResult,
  makeChain,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { createClient } from '@/lib/supabase/server';
import { WikiWriteError, commitEnvelopes } from '@/lib/wiki/writer/commit';
import { type WikiConfig, getWikiConfig } from '@/lib/wiki/writer/config';
import { knowledgeEnvelope } from '@/lib/wiki/writer/envelope';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/wiki/writer/config', () => ({ getWikiConfig: jest.fn() }));
// A partial mock: the commit is stubbed, but `WikiWriteError` stays the real class, since the
// route maps its `kind` to a status.
jest.mock('@/lib/wiki/writer/commit', () => ({
  ...jest.requireActual<typeof import('@/lib/wiki/writer/commit')>('@/lib/wiki/writer/commit'),
  commitEnvelopes: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockGetWikiConfig = jest.mocked(getWikiConfig);
const mockCommit = jest.mocked(commitEnvelopes);

pinClock('2026-09-25T22:30:00.000Z');

const CONFIG: WikiConfig = {
  owner: 'ac3charland',
  name: 'knowledge',
  token: 'secret-token',
  apiUrl: 'https://api.github.com',
};

const ID_A = '6f1c2b3a-0000-4000-8000-00000000000a';
const ID_B = '6f1c2b3a-0000-4000-8000-00000000000b';
const ID_C = '6f1c2b3a-0000-4000-8000-00000000000c';

/** An item as the route's read answers it: the envelope fields plus the shape it checks. */
interface StoredItem {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
  item_type: string;
  parent_id: string | null;
  dispatched_at: string | null;
}

function stored(id: string, overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id,
    title: `Idea ${id.slice(-1)}`,
    notes: null,
    source_url: null,
    item_type: 'knowledge',
    parent_id: null,
    dispatched_at: null,
    ...overrides,
  };
}

/**
 * A signed-in client whose two `items` reads answer in order: the rows by id, then the rows
 * whose parent is one of them. `rpc` is what `send_items_to_wiki` resolves with.
 */
function signedIn({
  rows = [stored(ID_A), stored(ID_B)],
  children = [],
  rowsError,
  childrenError,
  rpc = { data: 2 },
}: {
  rows?: StoredItem[];
  children?: { parent_id: string }[];
  rowsError?: MockResult['error'];
  childrenError?: MockResult['error'];
  rpc?: MockResult;
} = {}) {
  const rowsChain = makeChain({ list: { data: rows, error: rowsError } });
  const childrenChain = makeChain({ list: { data: children, error: childrenError } });
  const supabase = makeSupabaseDouble({}, rpc);
  supabase.from.mockReturnValueOnce(rowsChain).mockReturnValueOnce(childrenChain);
  mockCreateClient.mockResolvedValue(supabase as never);
  return { supabase, rowsChain, childrenChain };
}

function send(body: unknown): Request {
  return new Request('http://localhost/api/wiki/items', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

beforeEach(() => {
  mockGetWikiConfig.mockReturnValue(CONFIG);
  mockCommit.mockResolvedValue({ commitSha: 'c1', folders: [] });
});

describe('POST /api/wiki/items', () => {
  it('answers 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('answers 501 when the writer is not configured, before reading anything', async () => {
    mockGetWikiConfig.mockReturnValue(undefined);
    const { supabase } = signedIn();

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'The wiki is not configured on this deployment',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['no ids', { ids: [] }],
    ['a non-uuid id', { ids: ['not-a-uuid'] }],
    ['an unknown field', { ids: [ID_A], extra: true }],
    ['more than fifty ids', { ids: Array.from({ length: 51 }, () => ID_A) }],
  ])('refuses %s with 400', async (_label, body) => {
    const { supabase } = signedIn();

    const response = await POST(send(body), STUB_CONTEXT);

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('commits one envelope per item in ONE commit, then runs the RPC, and answers the ids', async () => {
    const rowA = stored(ID_A, { notes: 'Forgetting is the signal.' });
    const rowB = stored(ID_B, { source_url: 'https://example.com/spacing' });
    const { supabase } = signedIn({ rows: [rowB, rowA] });

    const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: [ID_A, ID_B] });
    // Envelopes follow the request's order, captured on the UTC day of the send.
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledWith(CONFIG, [
      knowledgeEnvelope(rowA, '2026-09-25'),
      knowledgeEnvelope(rowB, '2026-09-25'),
    ]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('send_items_to_wiki', { p_ids: [ID_A, ID_B] });
    // The commit lands before the rows are stamped and deleted.
    const [commitOrder] = mockCommit.mock.invocationCallOrder;
    const [rpcOrder] = supabase.rpc.mock.invocationCallOrder;
    expect(commitOrder).toBeLessThan(rpcOrder ?? 0);
  });

  it('reads the items by id and their children by parent, selecting only what it needs', async () => {
    const { supabase, rowsChain, childrenChain } = signedIn();

    await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'items');
    expect(supabase.from).toHaveBeenNthCalledWith(2, 'items');
    expect(rowsChain.select).toHaveBeenCalledWith(
      'id,title,notes,source_url,item_type,parent_id,dispatched_at',
    );
    expect(rowsChain.in).toHaveBeenCalledWith('id', [ID_A, ID_B]);
    expect(childrenChain.select).toHaveBeenCalledWith('parent_id');
    expect(childrenChain.in).toHaveBeenCalledWith('parent_id', [ID_A, ID_B]);
  });

  it('sends a repeated id once', async () => {
    const { supabase } = signedIn({ rows: [stored(ID_A)] });

    const response = await POST(send({ ids: [ID_A, ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: [ID_A] });
    expect(mockCommit.mock.calls[0]?.[1]).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledWith('send_items_to_wiki', { p_ids: [ID_A] });
  });

  it('answers 404 naming an id that is not there', async () => {
    const { supabase } = signedIn({ rows: [stored(ID_A)] });

    const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: `Item ${ID_B} not found` });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  describe('409 — an item the wiki cannot take', () => {
    it.each([
      ['is not knowledge', stored(ID_B, { item_type: 'task' }), [], 'is not a knowledge item'],
      ['is a subtask', stored(ID_B, { parent_id: ID_C }), [], 'is a subtask'],
      [
        'has already been dispatched',
        stored(ID_B, { dispatched_at: '2026-09-24T10:00:00Z' }),
        [],
        'has already been dispatched',
      ],
      ['has subtasks', stored(ID_B), [{ parent_id: ID_B }], 'has subtasks'],
      [
        'has subtasks and was dispatched — the shape fault is named first',
        stored(ID_B, { dispatched_at: '2026-09-24T10:00:00Z' }),
        [{ parent_id: ID_B }],
        'has subtasks',
      ],
    ])('refuses an item that %s, naming it', async (_label, bad, children, reason) => {
      const { supabase } = signedIn({ rows: [stored(ID_A), bad], children });

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: `Item ${ID_B} ${reason}` });
      expect(mockCommit).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
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
        error: `Item ${ID_C} is not a knowledge item`,
      });
    });
  });

  it.each([
    ['busy', 503, 'The wiki repo was busy — try again'],
    ['unauthorized', 502, "Couldn't reach the wiki repo"],
    ['rejected', 502, "Couldn't reach the wiki repo"],
    ['unreachable', 502, "Couldn't reach the wiki repo"],
  ] as const)(
    'maps a %s commit failure to %i and never touches the rows',
    async (kind, status, message) => {
      mockCommit.mockRejectedValue(new WikiWriteError(kind, `wiki: ${kind}`));
      const { supabase } = signedIn();

      const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: message });
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it('answers 500 when the RPC fails after the commit', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    signedIn({ rpc: { data: null, error: { message: 'boom', code: '23514' } } });

    const response = await POST(send({ ids: [ID_A, ID_B] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('maps a failed items read and commits nothing', async () => {
    signedIn({ rowsError: { message: 'permission denied', code: '42501' } });

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('maps a failed children read and commits nothing', async () => {
    signedIn({ childrenError: { message: 'permission denied', code: '42501' } });

    const response = await POST(send({ ids: [ID_A] }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
