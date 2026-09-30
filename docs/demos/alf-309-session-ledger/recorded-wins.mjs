/**
 * The ledger's recorded-wins rule, against a REAL Postgres.
 *
 * Boots the database package's throwaway cluster, applies every migration exactly as production
 * does, then calls `upsert_code_sessions` as `service_role` — the role the keyed POST
 * /api/code/sessions route's admin client runs as — twice for one session: first the row a
 * recording hook would write, then the row a backfill re-run rebuilds from history.
 *
 * Printed values are the rows' own invented fields and the RPC's counts, never an id or a
 * timestamp, so the output is byte-identical on every run and `demo -- verify` stays green.
 *
 * Run from the repo root: `node docs/demos/alf-309-session-ledger/recorded-wins.mjs`
 */
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const SESSION = 'session_01DemoRecordedWins';

const RECORDED = {
  session_id: SESSION,
  repo: 'ac3charland/alfred',
  prompt: 'ALF-9: the prompt exactly as the owner sent it',
  prompt_source: 'recorded',
  builder_sha: 'builder-at-launch',
  base_sha: 'head-at-session-start',
  cost_usd: 4.5,
  pr_state: 'open',
};

const RECONSTRUCTED = {
  ...RECORDED,
  prompt: 'ALF-9: a prompt rebuilt from history',
  prompt_source: 'reconstructed',
  builder_sha: 'builder-from-history',
  base_sha: 'main-from-history',
  cost_usd: 12.25,
  pr_state: 'merged',
  warnings: ['builder_changed_near_start'],
};

async function upsert(client, label, row) {
  await client.query('set role service_role');
  const { rows } = await client.query('select * from upsert_code_sessions($1::jsonb)', [
    JSON.stringify([row]),
  ]);
  await client.query('reset role');
  console.log(`${label} → ${JSON.stringify(rows[0])}`);
}

async function show(client) {
  const { rows } = await client.query(
    `select prompt, prompt_source, builder_sha, base_sha, cost_usd::text, pr_state, warnings
       from code_sessions where session_id = $1`,
    [SESSION],
  );
  for (const [column, value] of Object.entries(rows[0])) {
    console.log(`  ${column.padEnd(13)} ${JSON.stringify(value)}`);
  }
}

async function main() {
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

    await upsert(client, 'the recording hook writes', RECORDED);
    await upsert(client, 'a backfill re-run writes ', RECONSTRUCTED);
    console.log('\nThe stored row:');
    await show(client);
  } finally {
    await client.end();
    cluster.stop();
  }
}

await main();
