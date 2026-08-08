// Demo: the intended_epic_id column, its code-only CHECK, and the project-coherence trigger
// (migration 0027), exercised against a throwaway Postgres built from the repo's migrations.
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { MIGRATIONS_DIR, applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const OTHER_PROJECT = '22222222-2222-2222-2222-222222222222';
const EPIC = '33333333-3333-3333-3333-333333333333';

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
  await applyMigrations(client, MIGRATIONS_DIR);
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred'),
              ($2, 'RPL', 'Realplay', 'ac3charland', 'realplay')`,
    [PROJECT, OTHER_PROJECT],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ($1, $2, 'Inbox triage', 104, 'ALF-104')`,
    [EPIC, PROJECT],
  );

  const show = async (label, query, params) => {
    try {
      await client.query(query, params);
      console.log(`${label}: OK`);
    } catch (error) {
      console.log(`${label}: REJECTED — ${error.message}`);
    }
  };

  await show(
    'a task carrying an epic hint',
    `insert into items (title, item_type, intended_epic_id) values ('bad', 'task', $1)`,
    [EPIC],
  );
  await show(
    'an epic hint with no project hint',
    `insert into items (title, item_type, intended_epic_id) values ('bad', 'code', $1)`,
    [EPIC],
  );
  await show(
    "an epic from another project's intended project",
    `insert into items (title, item_type, intended_project_id, intended_epic_id)
       values ('bad', 'code', $1, $2)`,
    [OTHER_PROJECT, EPIC],
  );
  await show(
    'a coherent project + epic pair',
    `insert into items (id, title, item_type, intended_project_id, intended_epic_id)
       values ('44444444-4444-4444-4444-444444444444', 'good', 'code', $1, $2)`,
    [PROJECT, EPIC],
  );

  const surfaced = await client.query(
    `select intended_project_id, intended_epic_id from task_items
      where id = '44444444-4444-4444-4444-444444444444'`,
  );
  console.log('task_items surfaces the hints:', JSON.stringify(surfaced.rows[0]));

  // Deleting the epic nulls the epic hint, keeps the project hint and the row.
  await client.query(`delete from epics where id = $1`, [EPIC]);
  const afterDelete = await client.query(
    `select intended_project_id, intended_epic_id from items
      where id = '44444444-4444-4444-4444-444444444444'`,
  );
  console.log('after deleting the epic:', JSON.stringify(afterDelete.rows[0]));
} finally {
  await client.end();
  cluster.stop();
}
