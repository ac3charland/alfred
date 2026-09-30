// Replays migration 0042 over projects that already existed, on the throwaway Postgres cluster the
// database integration suite uses: every earlier migration, then the seeded rows, then 0042 itself.
// A backfill only touches rows that exist when it runs, so this is the only way to watch it act.
//
//   node docs/demos/alf-276-pr-ratio-exclude/migration-replay.mts
import path from 'node:path';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const MIGRATION = '0042_project_pr_ratio_exclusion.sql';

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
  await applyMigrations(client, undefined, (file) => path.basename(file) < MIGRATION);
  await client.query(
    `insert into projects (key, name, repo_owner, repo_name) values
       ('ALF', 'Alfred', 'ac3charland', 'alfred'),
       ('KNO', 'Knowledge', 'ac3charland', 'knowledge'),
       ('OKN', 'Other knowledge', 'someone-else', 'knowledge')`,
  );
  console.log(`--- applying ${MIGRATION} over three existing projects`);
  await applyMigrations(client, undefined, (file) => path.basename(file) === MIGRATION);
  const { rows } = await client.query<{ repo: string; excluded: boolean }>(
    `select repo_owner || '/' || repo_name as repo, exclude_from_pr_ratio as excluded
       from projects order by repo`,
  );
  for (const row of rows) console.log(`${row.repo.padEnd(24)} exclude_from_pr_ratio = ${String(row.excluded)}`);

  console.log('\n--- a project created afterwards counts by default');
  await client.query(
    `insert into projects (key, name, repo_owner, repo_name) values ('RPL', 'RealPlay', 'ac3charland', 'realplay')`,
  );
  const { rows: added } = await client.query<{ excluded: boolean }>(
    `select exclude_from_pr_ratio as excluded from projects where repo_name = 'realplay'`,
  );
  console.log(`ac3charland/realplay     exclude_from_pr_ratio = ${String(added[0]?.excluded)}`);
} finally {
  await client.end();
  cluster.stop();
}
