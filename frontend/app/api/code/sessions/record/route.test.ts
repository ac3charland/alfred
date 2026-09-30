/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type SupabaseDouble,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const LEDGER_KEY = 'ledger-key-xyz';
const INGEST_KEY = 'ingest-key-abc';

/** The body the hook sends on a Stop — the same file the hook's own tests must reproduce. */
const FIXTURE_PATH = path.resolve(
  process.cwd(),
  '../tools/session-ledger/src/hook/__fixtures__/recorded-row.json',
);

function contractFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

/** What the hook sends on a session start: the identity and the start commit, nulls included. */
function startRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'session-start',
    session_id: 'session_01FixtureStart',
    repo: 'ac3charland/alfred',
    base_sha: 'a'.repeat(40),
    builder_sha: null,
    warnings: [],
    ...overrides,
  };
}

function usage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requests: 1,
    input: 2,
    output: 3,
    cache_read: 4,
    cache_write_5m: 5,
    cache_write_1h: 6,
    web_search: 0,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/code/sessions/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const RPC_OK = { data: [{ inserted: false }], error: undefined };

/** A keyed caller: no cookie, served by the admin client. */
function keyed(rpcResult = RPC_OK): SupabaseDouble {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
  const admin = makeSupabaseDouble({}, rpcResult);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

describe('POST /api/code/sessions/record', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env.LEDGER_API_KEY = LEDGER_KEY;
    process.env.INGEST_API_KEY = INGEST_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  const withKey = { authorization: `Bearer ${LEDGER_KEY}` };

  describe('auth', () => {
    it('records through the admin client for the ledger key', async () => {
      const admin = keyed();

      const response = await POST(post(startRow(), withKey));

      expect(response.status).toBe(200);
      expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it('records through the session client for the signed-in owner', async () => {
      const session = makeSupabaseDouble({}, RPC_OK);
      mockCreateClient.mockResolvedValue(session as never);

      const response = await POST(post(startRow()));

      expect(response.status).toBe(200);
      expect(session.rpc).toHaveBeenCalledTimes(1);
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it.each([
      ['the ingest key as a Bearer token', { authorization: `Bearer ${INGEST_KEY}` }],
      ['the ingest key as x-api-key', { 'x-api-key': INGEST_KEY }],
      ['a wrong key', { authorization: 'Bearer not-the-key' }],
      ['no auth at all', {}],
    ])('rejects %s with 401 and writes nothing', async (_label, headers) => {
      const admin = keyed();

      const response = await POST(post(startRow(), headers));

      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });

  describe('recording', () => {
    it('hands the contract fixture to record_code_session unchanged', async () => {
      const fixture = contractFixture();
      const admin = keyed();

      const response = await POST(post(fixture, withKey));

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({ inserted: false });
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(admin.rpc).toHaveBeenCalledWith('record_code_session', { p_row: fixture });
    });

    it('answers inserted: true when the function created the row', async () => {
      keyed({ data: [{ inserted: true }], error: undefined });

      const response = await POST(post(startRow(), withKey));

      expect(await response.json()).toStrictEqual({ inserted: true });
    });

    it('accepts a session-start body, nulls included', async () => {
      const admin = keyed();
      const row = startRow({ session_created_at: '2026-10-03T09:12:40+00:00' });

      const response = await POST(post(row, withKey));

      expect(response.status).toBe(200);
      expect(admin.rpc).toHaveBeenCalledWith('record_code_session', { p_row: row });
    });

    it('accepts a stop carrying the recording warnings', async () => {
      keyed();
      const row = {
        ...contractFixture(),
        warnings: ['start_unrecorded', 'subagent_usage_partial', 'subagents_unreadable'],
      };

      const response = await POST(post(row, withKey));

      expect(response.status).toBe(200);
    });

    it('maps an RPC failure to its status', async () => {
      keyed({ data: null, error: { message: 'connection refused' } } as never);

      const response = await POST(post(startRow(), withKey));

      expect(response.status).toBe(500);
      expect(await response.json()).toStrictEqual({ error: 'connection refused' });
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown key', startRow({ lane: 'human' })],
      ['cost_usd, which the hook never sends', { ...contractFixture(), cost_usd: 1.5 }],
      ['a missing event', { ...startRow(), event: undefined }],
      ['an event outside the enum', startRow({ event: 'session-end' })],
      ['a missing session_id', { ...startRow(), session_id: undefined }],
      ['a malformed session_id', startRow({ session_id: 'session_01-bad' })],
      ['a session_id without the prefix', startRow({ session_id: '01Fixture' })],
      ['a malformed repo', startRow({ repo: 'not-a-repo' })],
      ['a missing warnings array', { ...startRow(), warnings: undefined }],
      ['a warning the hook never sends', startRow({ warnings: ['no_pr'] })],
      ['a warning the database owns', startRow({ warnings: ['price_unknown'] })],
      ['a timestamp without an offset', startRow({ session_created_at: '2026-10-03 09:12' })],
      ['a negative token count', { ...contractFixture(), input_tokens: -1 }],
      ['a fractional token count', { ...contractFixture(), output_tokens: 1.5 }],
      ['a negative subagent count', { ...contractFixture(), subagent_count: -1 }],
      ['a skill without a path', { ...contractFixture(), skills: [{ path: '', blob_sha: null }] }],
      [
        'a skill with an extra key',
        { ...contractFixture(), skills: [{ path: 'x', blob_sha: null, n: 1 }] },
      ],
      [
        'a usage entry missing a field',
        {
          ...contractFixture(),
          usage_by_model: { main: { m: { ...usage(), web_search: undefined } }, subagents: {} },
        },
      ],
      [
        'a usage entry with an unknown field',
        {
          ...contractFixture(),
          usage_by_model: { main: { m: usage({ cost: 1 }) }, subagents: {} },
        },
      ],
      [
        'a negative usage count',
        {
          ...contractFixture(),
          usage_by_model: { main: { m: usage({ requests: -1 }) }, subagents: {} },
        },
      ],
      [
        'usage_by_model without the subagents side',
        { ...contractFixture(), usage_by_model: { main: {} } },
      ],
      [
        'usage_by_model with an unknown side',
        { ...contractFixture(), usage_by_model: { main: {}, subagents: {}, other: {} } },
      ],
    ])('rejects %s with 400', async (_label, body) => {
      const admin = keyed();

      const response = await POST(post(body, withKey));

      expect(response.status).toBe(400);
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('accepts null for every optional field, as the hook sends them', async () => {
      keyed();
      const row = {
        event: 'stop',
        session_id: 'session_01Nulls',
        repo: 'ac3charland/alfred',
        session_created_at: null,
        base_sha: null,
        builder_sha: null,
        prompt: null,
        skills: null,
        ref: null,
        model: null,
        served_model: null,
        effort_level: null,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        subagent_count: null,
        usage_by_model: null,
        warnings: [],
      };

      const response = await POST(post(row, withKey));

      expect(response.status).toBe(200);
    });

    it('rejects a body that is not JSON with 400', async () => {
      const admin = keyed();

      const response = await POST(post('{not json', withKey));

      expect(response.status).toBe(400);
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });
});
