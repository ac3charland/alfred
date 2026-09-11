/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { DELETE } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const HANDLE_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_handles: { list: { data: undefined } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function request(): Request {
  return new Request(`http://localhost/api/comms/handles/${HANDLE_ID}`, { method: 'DELETE' });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/comms/handles/[id]', () => {
  it('drops the handle by its own id — the person is implied', async () => {
    const supabase = signedIn();

    const response = await DELETE(request(), context(HANDLE_ID));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(supabase.table('comm_handles').eq).toHaveBeenCalledWith('id', HANDLE_ID);
  });

  it('rejects a malformed id before touching the database', async () => {
    const supabase = signedIn();
    const response = await DELETE(request(), context('nope'));
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('maps a failed delete to its status', async () => {
    signedIn({ comm_handles: { list: { data: undefined, error: { message: 'boom' } } } });
    const response = await DELETE(request(), context(HANDLE_ID));
    expect(response.status).toBe(500);
  });

  it('returns 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const response = await DELETE(request(), context(HANDLE_ID));
    expect(response.status).toBe(401);
  });
});
