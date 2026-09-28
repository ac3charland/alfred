/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { resolveIngestClient, validateApiKey, withSession } from './auth';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const STUB_CONTEXT = { params: Promise.resolve({}) };

function makeSupabaseMock(user?: { id: string }) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  };
}

describe('validateApiKey', () => {
  const CONFIGURED_KEY = 'secret-key-123';

  beforeEach(() => {
    process.env.INGEST_API_KEY = CONFIGURED_KEY;
  });

  afterEach(() => {
    delete process.env.INGEST_API_KEY;
  });

  it('returns false when INGEST_API_KEY is not configured', () => {
    delete process.env.INGEST_API_KEY;
    const request = new Request('http://localhost/', {
      headers: { 'x-api-key': CONFIGURED_KEY },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns false when INGEST_API_KEY is an empty string', () => {
    process.env.INGEST_API_KEY = '';
    const request = new Request('http://localhost/', {
      headers: { 'x-api-key': '' },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns true when x-api-key header matches the configured key', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-api-key': CONFIGURED_KEY },
    });
    expect(validateApiKey(request)).toBe(true);
  });

  it('returns false when x-api-key header does NOT match the configured key', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns true when Authorization Bearer token matches', () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: `Bearer ${CONFIGURED_KEY}` },
    });
    expect(validateApiKey(request)).toBe(true);
  });

  it('returns false when Authorization Bearer token does NOT match', () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns false when Authorization header is present but not a Bearer token', () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: `Basic ${CONFIGURED_KEY}` },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns false when Authorization header has a non-Bearer scheme even if slice(7) matches key', () => {
    // "NotBear" is exactly 7 chars, so "NotBear" + CONFIGURED_KEY has slice(7) === CONFIGURED_KEY.
    // startsWith('Bearer ') is false (real code → returns false).
    // startsWith('') is true (mutant → enters Bearer block → bearerKey === configuredKey → returns true).
    // This distinguishes and kills the startsWith("") mutant.
    const request = new Request('http://localhost/', {
      headers: { authorization: `NotBear${CONFIGURED_KEY}` },
    });
    expect(validateApiKey(request)).toBe(false);
  });

  it('returns false when no auth headers are present', () => {
    const request = new Request('http://localhost/');
    expect(validateApiKey(request)).toBe(false);
  });
});

describe('withSession', () => {
  it('returns 401 without calling the handler when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseMock() as never);
    const handler = jest.fn();

    const route = withSession(handler);
    const response = await route(new Request('http://localhost/'), STUB_CONTEXT);

    expect(response.status).toBe(401);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ error: 'Unauthorized' });
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

describe('resolveIngestClient', () => {
  const CONFIGURED_KEY = 'ingest-key-abc';
  const mockAdminSupabase = { from: jest.fn() };

  beforeEach(() => {
    process.env.INGEST_API_KEY = CONFIGURED_KEY;
    mockCreateAdminClient.mockReturnValue(mockAdminSupabase as never);
  });

  afterEach(() => {
    delete process.env.INGEST_API_KEY;
  });

  it('returns the admin client with isAdmin=true when a valid x-api-key is provided', async () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-api-key': CONFIGURED_KEY },
    });
    const result = await resolveIngestClient(request);

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.isAdmin).toBe(true);
    expect(result.supabase).toBe(mockAdminSupabase);
    expect(mockCreateAdminClient).toHaveBeenCalled();
  });

  it('returns the admin client with isAdmin=true when a valid Bearer token is provided', async () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: `Bearer ${CONFIGURED_KEY}` },
    });
    const result = await resolveIngestClient(request);

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.isAdmin).toBe(true);
  });

  it('returns a 401 Response with error body when no API key and no session', async () => {
    delete process.env.INGEST_API_KEY;
    mockCreateClient.mockResolvedValue(makeSupabaseMock() as never);

    const request = new Request('http://localhost/');
    const result = await resolveIngestClient(request);

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;
    expect(result.status).toBe(401);
    const body: unknown = await result.json();
    expect(body).toStrictEqual({ error: 'Unauthorized' });
  });

  it('returns the session supabase with isAdmin=false when authenticated via session', async () => {
    delete process.env.INGEST_API_KEY;
    const user = { id: 'user-123' };
    const mockSupabase = makeSupabaseMock(user);
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/');
    const result = await resolveIngestClient(request);

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.isAdmin).toBe(false);
    expect(result.supabase).toBe(mockSupabase);
  });
});
