/** @jest-environment node */
import { createClient } from '@/lib/supabase/server';

import { withSession } from './auth';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const STUB_CONTEXT = { params: Promise.resolve({}) };

function makeSupabaseMock(user?: { id: string }) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  };
}

describe('withSession', () => {
  it('returns 401 without calling the handler when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseMock() as never);
    const handler = jest.fn();

    const route = withSession(handler);
    const response = await route(new Request('http://localhost/'), STUB_CONTEXT);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls the handler with the session when authenticated', async () => {
    const user = { id: 'user-123' };
    const mockSupabase = makeSupabaseMock(user);
    mockCreateClient.mockResolvedValue(mockSupabase as never);
    const handler = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const route = withSession(handler);
    const response = await route(new Request('http://localhost/'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ user }),
      expect.any(Request),
      STUB_CONTEXT,
    );
  });
});
