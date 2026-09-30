/**
 * Pricing and column ownership for recorded sessions, against a REAL Postgres.
 *
 * Boots the database package's throwaway cluster, applies every migration exactly as production
 * does, then plays one session's life as `service_role` (the role both keyed routes' admin client
 * and the Worker run as):
 *
 *   1. the hook records a stop before any price is known → `price_unknown`, no cost;
 *   2. the Worker's parser reads the captured pricing page and `append_model_prices` stores it →
 *      the session is re-priced;
 *   3. the same table again → nothing appended;
 *   4. a backfill re-run for the same session → the recorded columns stay, the PR fields fill in.
 *
 * Printed values are the fixtures' own invented fields, counts and costs, never a timestamp, so
 * the output is byte-identical on every run and `demo -- verify` stays green.
 *
 * Run from the repo root: `node docs/demos/alf-310-session-recording/prices-and-ownership.mjs`
 */
import { readFileSync } from 'node:fs';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';
import { ParseError, parsePricingPage } from '../../../workers/src/pricing/page.ts';

const STOP = JSON.parse(
  readFileSync('tools/session-ledger/src/hook/__fixtures__/recorded-row.json', 'utf8'),
);
const PAGE = readFileSync('workers/src/pricing/__fixtures__/pricing-2026-09-30.txt', 'utf8');

const SHOWN = [
  'prompt_source',
  'output_tokens',
  'subagent_count',
  'cost_usd',
  'base_sha',
  'pr_state',
  'launch_lane',
  'warnings',
];

async function asServiceRole(client, sql, params) {
  await client.query('set role service_role');
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query('reset role');
  }
}

async function show(client, label) {
  const [row] = await client.query(
    `select ${SHOWN.map((c) => (c === 'cost_usd' ? 'cost_usd::text as cost_usd' : c)).join(', ')}
       from code_sessions where session_id = $1`,
    [STOP.session_id],
  ).then((r) => r.rows);
  console.log(`${label}\n  ${JSON.stringify(row)}`);
}

const cluster = await startCluster();
const client = new pg.Client({
  host: cluster.host,
  port: cluster.port,
  user: cluster.user,
  database: cluster.database,
});
try {
  await client.connect();
  await bootstrapSupabase(client);
  await applyMigrations(client);

  await asServiceRole(client, 'select * from record_code_session($1::jsonb)', [
    JSON.stringify({
      event: 'session-start',
      session_id: STOP.session_id,
      repo: STOP.repo,
      session_created_at: '2026-10-03T09:12:40Z',
      base_sha: 'head-at-session-start',
      builder_sha: null,
      warnings: [],
    }),
  ]);
  await asServiceRole(client, 'select * from record_code_session($1::jsonb)', [
    JSON.stringify(STOP),
  ]);
  await show(client, '1 · the hook recorded the session start and a stop; no prices yet:');

  const rates = parsePricingPage(PAGE, new Set());
  if (rates instanceof ParseError) throw new Error(`the captured page did not parse: ${rates.reason}`);
  console.log(
    `2 · the Worker's parser read ${String(Object.keys(rates).length)} models from the page, e.g.\n` +
      `  claude-opus-5-5  ${JSON.stringify(rates['claude-opus-5-5'])}\n` +
      `  claude-haiku-4-5 ${JSON.stringify(rates['claude-haiku-4-5'])}`,
  );
  const source = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
  const [first] = await asServiceRole(
    client,
    'select appended, cardinality(changed) as changed, repriced from append_model_prices($1::jsonb, $2)',
    [JSON.stringify(rates), source],
  );
  console.log(`  append_model_prices → ${JSON.stringify(first)}`);
  await show(client, '  the recorded session, re-priced (haiku-4-5-20251001 priced as haiku-4-5):');

  const [again] = await asServiceRole(
    client,
    'select appended, cardinality(changed) as changed, repriced from append_model_prices($1::jsonb, $2)',
    [JSON.stringify(rates), source],
  );
  console.log(`3 · the same table again → ${JSON.stringify(again)}`);

  await asServiceRole(client, 'select * from upsert_code_sessions($1::jsonb)', [
    JSON.stringify([
      {
        session_id: STOP.session_id,
        repo: STOP.repo,
        prompt: 'a prompt rebuilt from history',
        prompt_source: 'reconstructed',
        base_sha: 'main-from-history',
        output_tokens: 999_999,
        cost_usd: 12.25,
        pr_number: 428,
        pr_state: 'merged',
        launch_lane: 'implementation',
        warnings: ['builder_changed_near_start'],
      },
    ]),
  ]);
  await show(client, '4 · a backfill re-run: recorded usage, cost, prompt and start kept; PR fields filled:');
} finally {
  await client.end();
  cluster.stop();
}
