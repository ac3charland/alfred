/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
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

/** One complete ledger row — every column but `refreshed_at`, invented values throughout. */
function ledgerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'session_01Fixture',
    repo: 'ac3charland/alfred',
    title: 'ALF-9: a fixture story',
    session_created_at: '2026-09-30T02:42:53Z',
    status: 'SESSION_STATUS_BUCKET_COMPLETED',
    configured_model: 'claude-sonnet-5-5',
    model: 'claude-sonnet-5-5',
    served_model: 'claude-sonnet-5-5',
    effort_level: 'high',
    cost_usd: 12.5,
    input_tokens: 1000,
    output_tokens: 2000,
    cache_read_tokens: 300_000,
    cache_write_tokens: 4000,
    ref: 'ALF-9',
    launch_lane: 'implementation',
    pr_number: 42,
    pr_state: 'merged',
    pr_opened_at: '2026-09-30T04:00:00Z',
    pr_merged_at: '2026-09-30T12:00:00Z',
    pr_closed_at: '2026-09-30T12:00:00Z',
    human_commits_after_open: 0,
    base_sha: 'a'.repeat(40),
    builder_sha: 'b'.repeat(40),
    prompt: 'ALF-9: a fixture story\n\nYou are implementing…',
    prompt_source: 'reconstructed',
    spec_path: 'docs/specs/ALF-9.html',
    spec_blob_sha: 'c'.repeat(40),
    skills: [{ path: '.claude/skills/implement-spec/SKILL.md', blob_sha: 'd'.repeat(40) }],
    warnings: [],
    session_record: { id: 'session_01Fixture' },
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/code/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const RPC_OK = { data: [{ upserted: 1, kept_recorded: 0 }], error: undefined };

/** A keyed caller: no cookie, served by the admin client. */
function keyed(rpcResult = RPC_OK): SupabaseDouble {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
  const admin = makeSupabaseDouble({}, rpcResult);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

describe('POST /api/code/sessions', () => {
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
    it('upserts through the admin client for the ledger key', async () => {
      const admin = keyed();

      const response = await POST(post({ rows: [ledgerRow()] }, withKey));

      expect(response.status).toBe(200);
      expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it('upserts through the session client for the signed-in owner', async () => {
      const session = makeSupabaseDouble({}, RPC_OK);
      mockCreateClient.mockResolvedValue(session as never);

      const response = await POST(post({ rows: [ledgerRow()] }));

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

      const response = await POST(post({ rows: [ledgerRow()] }, headers));

      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('rejects every keyed call when LEDGER_API_KEY is unset', async () => {
      delete process.env.LEDGER_API_KEY;
      const admin = keyed();

      const response = await POST(post({ rows: [ledgerRow()] }, { authorization: 'Bearer ' }));

      expect(response.status).toBe(401);
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('lands a valid batch through upsert_code_sessions and answers its counts', async () => {
      const admin = keyed({ data: [{ upserted: 2, kept_recorded: 1 }], error: undefined });
      const rows = [ledgerRow(), ledgerRow({ session_id: 'session_02Other', pr_number: null })];

      const response = await POST(post({ rows }, withKey));

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({ upserted: 2, kept_recorded: 1 });
      expect(admin.rpc).toHaveBeenCalledWith('upsert_code_sessions', { p_rows: rows });
    });

    it('accepts a no-PR row: nulls everywhere but the session fields', async () => {
      keyed();
      const row = ledgerRow({
        launch_lane: null,
        pr_number: null,
        pr_state: null,
        pr_opened_at: null,
        pr_merged_at: null,
        pr_closed_at: null,
        human_commits_after_open: null,
        builder_sha: null,
        prompt: null,
        prompt_source: null,
        spec_path: null,
        spec_blob_sha: null,
        skills: [],
        warnings: ['no_pr', 'ref_from_title'],
      });

      const response = await POST(post({ rows: [row] }, withKey));

      expect(response.status).toBe(200);
    });

    it('rejects an empty batch with 400', async () => {
      const admin = keyed();

      const response = await POST(post({ rows: [] }, withKey));

      expect(response.status).toBe(400);
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('rejects more than 100 rows with 413', async () => {
      const admin = keyed();
      const rows = Array.from({ length: 101 }, (_, index) =>
        ledgerRow({ session_id: `session_${String(index)}` }),
      );

      const response = await POST(post({ rows }, withKey));

      expect(response.status).toBe(413);
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('accepts exactly 100 rows', async () => {
      keyed();
      const rows = Array.from({ length: 100 }, (_, index) =>
        ledgerRow({ session_id: `session_${String(index)}` }),
      );

      const response = await POST(post({ rows }, withKey));

      expect(response.status).toBe(200);
    });

    it.each([
      ['an unknown row key', { rows: [ledgerRow({ lane: 'human' })] }],
      ['a row missing a column', { rows: [{ ...ledgerRow(), prompt: undefined }] }],
      ['refreshed_at, which the database owns', { rows: [ledgerRow({ refreshed_at: 'now' })] }],
      ['an unknown envelope key', { rows: [ledgerRow()], dry_run: true }],
      ['a lane outside the enum', { rows: [ledgerRow({ launch_lane: 'human' })] }],
      ['a negative cost', { rows: [ledgerRow({ cost_usd: -1 })] }],
      ['a skill without a blob key', { rows: [ledgerRow({ skills: [{ path: 'x' }] })] }],
      ['no rows array', { row: ledgerRow() }],
    ])('rejects %s with 400', async (_label, body) => {
      const admin = keyed();

      const response = await POST(post(body, withKey));

      expect(response.status).toBe(400);
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('rejects a batch naming one session twice — the upsert would fail on it', async () => {
      const admin = keyed();

      const response = await POST(post({ rows: [ledgerRow(), ledgerRow()] }, withKey));

      expect(response.status).toBe(400);
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('rejects a body that is not JSON with 400', async () => {
      keyed();

      const response = await POST(post('{not json', withKey));

      expect(response.status).toBe(400);
    });
  });

  it('maps an RPC failure to its status', async () => {
    keyed({ data: null, error: { message: 'connection refused' } } as never);

    const response = await POST(post({ rows: [ledgerRow()] }, withKey));

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'connection refused' });
  });
});
