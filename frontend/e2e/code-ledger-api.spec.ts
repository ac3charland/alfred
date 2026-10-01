import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  INGEST_API_KEY,
  LEDGER_API_KEY,
  MOCK_URL,
  makeCodeStory,
  makeEpic,
  makeItem,
  makeProject,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The session-ledger routes through the whole stack: the backfill reads the ledger inputs, then
 * upserts rows, and a session's recording hook writes its own row, all keyed with the ledger key
 * and carrying no cookie. The ingest key is refused on every one — a session reads untrusted
 * text, so its key reaches nothing else.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const project = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111' });
const epic = makeEpic('Fixture epic', { project_id: project.id, ref_number: 4, ref: 'ALF-4' });
const item = makeItem('Give feedback when pressed', {
  item_type: 'code',
  notes: 'Invented ticket notes.',
});
const story = makeCodeStory({
  item_id: item.id,
  project_id: project.id,
  epic_id: epic.id,
  ref_number: 9,
  ref: 'ALF-9',
  spec_path: 'docs/specs/ALF-9.html',
  spec_markdown: '<h1>a large spec snapshot</h1>',
});

const ledgerKey = { authorization: `Bearer ${LEDGER_API_KEY}` };

/** One complete ledger row with invented values. */
function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: 'session_01E2eLedger',
    repo: 'ac3charland/alfred',
    title: 'ALF-9 session',
    session_created_at: '2026-07-10T01:00:00Z',
    status: 'SESSION_STATUS_BUCKET_COMPLETED',
    configured_model: 'claude-opus-5-5',
    model: 'claude-opus-5-5',
    served_model: 'claude-opus-5-5',
    effort_level: 'high',
    cost_usd: 4.5,
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 30,
    cache_write_tokens: 40,
    ref: 'ALF-9',
    launch_lane: 'implementation',
    pr_number: 2,
    pr_state: 'open',
    pr_opened_at: '2026-07-10T02:00:00Z',
    pr_merged_at: null,
    pr_closed_at: null,
    human_commits_after_open: 0,
    base_sha: 'base-at-launch',
    builder_sha: 'builder-at-launch',
    prompt: 'the prompt exactly as sent',
    prompt_source: 'recorded',
    spec_path: 'docs/specs/ALF-9.html',
    spec_blob_sha: null,
    skills: [],
    warnings: [],
    session_record: { id: 'session_01E2eLedger' },
    ...overrides,
  };
}

test('reads the ledger inputs with the ledger key — notes in, spec snapshots out', async ({
  request,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  const response = await request.get('/api/code/ledger-inputs?repo=ac3charland/alfred', {
    headers: ledgerKey,
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    project: { id: string };
    stories: Record<string, unknown>[];
    epics: Record<string, unknown>[];
  };

  expect(body.project.id).toBe(project.id);
  expect(body.stories).toHaveLength(1);
  expect(body.stories[0]).toMatchObject({ ref: 'ALF-9', notes: 'Invented ticket notes.' });
  expect(body.stories[0]).not.toHaveProperty('spec_markdown');
  expect(body.epics.map((e) => e['ref'])).toEqual(['ALF-4']);

  const unknown = await request.get('/api/code/ledger-inputs?repo=someone/else', {
    headers: ledgerKey,
  });
  expect(unknown.status()).toBe(404);
});

test('upserts rows, keeping a recorded prompt over a reconstructed re-run', async ({
  request,
  seed,
}) => {
  await seed({});

  const first = await request.post('/api/code/sessions', {
    headers: ledgerKey,
    data: { rows: [row({})] },
  });
  expect(await first.json()).toEqual({ upserted: 1, kept_recorded: 0 });

  const rerun = await request.post('/api/code/sessions', {
    headers: ledgerKey,
    data: {
      rows: [
        row({
          prompt: 'a rebuilt guess',
          prompt_source: 'reconstructed',
          builder_sha: 'builder-from-history',
          cost_usd: 9.75,
          pr_state: 'merged',
        }),
      ],
    },
  });
  expect(await rerun.json()).toEqual({ upserted: 1, kept_recorded: 1 });

  const stateResponse = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await stateResponse.json()) as {
    codeSessions: Record<string, unknown>[];
  };
  expect(state.codeSessions).toHaveLength(1);
  expect(state.codeSessions[0]).toMatchObject({
    prompt: 'the prompt exactly as sent',
    prompt_source: 'recorded',
    builder_sha: 'builder-at-launch',
    cost_usd: 9.75,
    pr_state: 'merged',
  });
});

test('refuses the ingest key on both ledger routes', async ({ request, seed }) => {
  await seed({ projects: [project] });

  const read = await request.get('/api/code/ledger-inputs?repo=ac3charland/alfred', {
    headers: { 'x-api-key': INGEST_API_KEY },
  });
  const write = await request.post('/api/code/sessions', {
    headers: { authorization: `Bearer ${INGEST_API_KEY}` },
    data: { rows: [row({})] },
  });

  expect(read.status()).toBe(401);
  expect(write.status()).toBe(401);
});

/**
 * The hook's stop body exactly as the hook builds it — the fixture the hook's own contract test
 * produces. Resolved against the Playwright working directory (frontend/).
 */
function recordedStop(): Record<string, unknown> {
  const file = path.join(
    process.cwd(),
    '..',
    'tools/session-ledger/src/hook/__fixtures__/recorded-row.json',
  );
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

test('records a session through the hook route; a backfill re-run keeps what it recorded', async ({
  request,
  seed,
}) => {
  await seed({});
  const stop = recordedStop();
  const sessionId = stop['session_id'] as string;

  const start = await request.post('/api/code/sessions/record', {
    headers: ledgerKey,
    data: {
      event: 'session-start',
      session_id: sessionId,
      repo: 'ac3charland/alfred',
      session_created_at: '2026-10-03T09:12:40Z',
      base_sha: 'head-at-session-start',
      builder_sha: null,
      warnings: [],
    },
  });
  expect(await start.json()).toEqual({ inserted: true });

  const recorded = await request.post('/api/code/sessions/record', {
    headers: ledgerKey,
    data: stop,
  });
  expect(await recorded.json()).toEqual({ inserted: false });

  const refused = await request.post('/api/code/sessions/record', {
    headers: { authorization: `Bearer ${INGEST_API_KEY}` },
    data: stop,
  });
  expect(refused.status()).toBe(401);
  const withCost = await request.post('/api/code/sessions/record', {
    headers: ledgerKey,
    data: { ...stop, cost_usd: 1 },
  });
  expect(withCost.status()).toBe(400);

  const rerun = await request.post('/api/code/sessions', {
    headers: ledgerKey,
    data: {
      rows: [
        row({
          session_id: sessionId,
          prompt: 'a rebuilt guess',
          prompt_source: 'reconstructed',
          base_sha: 'main-from-history',
          output_tokens: 999_999,
          cost_usd: 9.75,
          pr_state: 'merged',
          warnings: ['builder_changed_near_start'],
        }),
      ],
    },
  });
  expect(await rerun.json()).toEqual({ upserted: 1, kept_recorded: 1 });

  const stateResponse = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await stateResponse.json()) as { codeSessions: Record<string, unknown>[] };
  expect(state.codeSessions).toHaveLength(1);
  expect(state.codeSessions[0]).toMatchObject({
    prompt: stop['prompt'],
    prompt_source: 'recorded',
    skills: stop['skills'],
    base_sha: 'head-at-session-start',
    output_tokens: stop['output_tokens'],
    usage_by_model: stop['usage_by_model'],
    subagent_count: stop['subagent_count'],
    cost_usd: null,
    pr_state: 'merged',
    warnings: ['builder_changed_near_start', 'price_unknown', 'subagents_unreadable'],
  });
});
