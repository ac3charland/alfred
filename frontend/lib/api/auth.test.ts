/** @jest-environment node */
import { createClient } from '@/lib/supabase/server';

import { getSessionOrUnauthorized } from './auth';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

function makeSupabaseMock(user?: { id: string }) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  };
}

describe('getSessionOrUnauthorized', () => {
  it('returns a 401 Response when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseMock() as never);

    const result = await getSessionOrUnauthorized();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    const body: unknown = await (result as Response).json();
    expect(body).toStrictEqual({ error: 'Unauthorized' });
  });

  it('returns the session when authenticated', async () => {
    const user = { id: 'user-123' };
    mockCreateClient.mockResolvedValue(makeSupabaseMock(user) as never);

    const result = await getSessionOrUnauthorized();

    expect(result).not.toBeInstanceOf(Response);
    expect((result as { user: typeof user }).user).toStrictEqual(user);
  });
});
