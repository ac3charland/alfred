/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import {
  resolveIngestClient,
  resolveLedgerClient,
  validateApiKey,
  validateLedgerKey,
  withSession,
} from './auth';

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

function bearer(key: string): Request {
  return new Request('http://localhost/', { headers: { authorization: `Bearer ${key}` } });
}

describe('validateLedgerKey', () => {
  const LEDGER_KEY = 'ledger-key-xyz';

  beforeEach(() => {
    process.env.LEDGER_API_KEY = LEDGER_KEY;
  });

  afterEach(() => {
    delete process.env.LEDGER_API_KEY;
    delete process.env.INGEST_API_KEY;
  });

  it('accepts the ledger key as a Bearer token', () => {
    expect(validateLedgerKey(bearer(LEDGER_KEY))).toBe(true);
  });

  it('rejects a wrong key, including one that shares the right key as a prefix', () => {
    expect(validateLedgerKey(bearer('wrong-key'))).toBe(false);
    expect(validateLedgerKey(bearer(`${LEDGER_KEY}x`))).toBe(false);
    expect(validateLedgerKey(bearer(LEDGER_KEY.slice(0, -1)))).toBe(false);
  });

  it('rejects the ingest key — the two credentials never stand in for each other', () => {
    process.env.INGEST_API_KEY = 'ingest-key-abc';
    expect(validateLedgerKey(bearer('ingest-key-abc'))).toBe(false);
  });

  it('rejects everything when LEDGER_API_KEY is unset or empty', () => {
    delete process.env.LEDGER_API_KEY;
    expect(validateLedgerKey(bearer(''))).toBe(false);
    expect(validateLedgerKey(bearer('undefined'))).toBe(false);
    process.env.LEDGER_API_KEY = '';
    expect(validateLedgerKey(bearer(''))).toBe(false);
  });

  it('accepts only the Bearer scheme — not x-api-key, not another scheme', () => {
    expect(
      validateLedgerKey(new Request('http://localhost/', { headers: { 'x-api-key': LEDGER_KEY } })),
    ).toBe(false);
    expect(
      validateLedgerKey(
        new Request('http://localhost/', { headers: { authorization: `Basic ${LEDGER_KEY}` } }),
      ),
    ).toBe(false);
    expect(validateLedgerKey(new Request('http://localhost/'))).toBe(false);
  });
});

describe('the ingest key and the ledger key are disjoint', () => {
  afterEach(() => {
    delete process.env.LEDGER_API_KEY;
    delete process.env.INGEST_API_KEY;
  });

  it('validateApiKey (every ingest route) rejects the ledger key', () => {
    process.env.INGEST_API_KEY = 'ingest-key-abc';
    process.env.LEDGER_API_KEY = 'ledger-key-xyz';
    const request = new Request('http://localhost/', {
      headers: { authorization: 'Bearer ledger-key-xyz' },
    });
    expect(validateApiKey(request)).toBe(false);
  });
});

describe('resolveLedgerClient', () => {
  const LEDGER_KEY = 'ledger-key-xyz';
  const mockAdminSupabase = { from: jest.fn() };

  beforeEach(() => {
    process.env.LEDGER_API_KEY = LEDGER_KEY;
    mockCreateAdminClient.mockReturnValue(mockAdminSupabase as never);
  });

  afterEach(() => {
    delete process.env.LEDGER_API_KEY;
  });

  it('resolves the admin client for a valid ledger key, without reading a session', async () => {
    const request = new Request('http://localhost/', {
      headers: { authorization: `Bearer ${LEDGER_KEY}` },
    });
    const result = await resolveLedgerClient(request);

    expect(result).toBe(mockAdminSupabase);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('resolves the session client for the signed-in owner', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-123' });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const result = await resolveLedgerClient(new Request('http://localhost/'));

    expect(result).toBe(mockSupabase);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('answers 401 with neither', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseMock() as never);

    const result = await resolveLedgerClient(
      new Request('http://localhost/', { headers: { authorization: 'Bearer wrong' } }),
    );

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;
    expect(result.status).toBe(401);
    expect(await result.json()).toStrictEqual({ error: 'Unauthorized' });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
