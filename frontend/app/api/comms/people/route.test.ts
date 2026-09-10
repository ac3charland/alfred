/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PERSON_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PERSON = { id: PERSON_ID, name: 'Dana Whitfield', priority: 'high', notes: null };
const HANDLE = { id: 'h1', person_id: PERSON_ID, handle: 'dana@example.com', kind: 'email' };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_people: {
      list: { data: [{ ...PERSON, comm_handles: [HANDLE] }] },
      single: { data: PERSON },
    },
    comm_handles: { list: { data: [HANDLE] } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function signedOut(): void {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function read(): Request {
  return new Request('http://localhost/api/comms/people');
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/comms/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/comms/people', () => {
  it('returns the roster with each person’s handles embedded, ordered by name', async () => {
    const supabase = signedIn();

    const response = await GET(read(), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ ...PERSON, comm_handles: [HANDLE] }]);
    const chain = supabase.table('comm_people');
    expect(chain.select).toHaveBeenCalledWith('*,comm_handles(*)');
    expect(chain.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await GET(read(), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_people: { list: { data: undefined, error: { message: 'boom' } } } });
    const response = await GET(read(), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/comms/people', () => {
  it('creates the person and returns them with an empty handle list', async () => {
    const supabase = signedIn();

    const response = await POST(postRequest({ name: 'Dana Whitfield' }), STUB_CONTEXT);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ...PERSON, comm_handles: [] });
    // `priority` defaults to high in the schema, so the roster's reason for existing is the
    // default rather than something every caller has to restate.
    expect(supabase.table('comm_people').insert).toHaveBeenCalledWith({
      name: 'Dana Whitfield',
      priority: 'high',
    });
  });

  it('stores every handle normalised, and returns them with the person', async () => {
    const supabase = signedIn();

    const response = await POST(
      postRequest({
        name: 'Dana Whitfield',
        priority: 'normal',
        notes: 'wife',
        handles: [
          { handle: '  Dana@Example.com ', kind: 'email' },
          { handle: '+1 (555) 010-2233', kind: 'phone' },
        ],
      }),
      STUB_CONTEXT,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ...PERSON, comm_handles: [HANDLE] });
    expect(supabase.table('comm_people').insert).toHaveBeenCalledWith({
      name: 'Dana Whitfield',
      priority: 'normal',
      notes: 'wife',
    });
    expect(supabase.table('comm_handles').insert).toHaveBeenCalledWith([
      { person_id: PERSON_ID, handle: 'dana@example.com', kind: 'email' },
      { person_id: PERSON_ID, handle: '+15550102233', kind: 'phone' },
    ]);
  });

  it('answers 409 for a handle another person already claims, and leaves no orphan behind', async () => {
    const supabase = signedIn({
      comm_handles: {
        list: {
          data: undefined,
          error: { message: 'duplicate key value violates unique constraint', code: '23505' },
        },
      },
    });

    const response = await POST(
      postRequest({ name: 'Dana', handles: [{ handle: 'dana@example.com', kind: 'email' }] }),
      STUB_CONTEXT,
    );

    expect(response.status).toBe(409);
    // The person written a moment ago is removed, so the retry doesn't create a second Dana.
    expect(supabase.table('comm_people').delete).toHaveBeenCalled();
    expect(supabase.table('comm_people').eq).toHaveBeenCalledWith('id', PERSON_ID);
  });

  it('rejects a nameless person', async () => {
    signedIn();
    const response = await POST(postRequest({ name: '  ' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await POST(postRequest({ name: 'Dana' }), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });
});
