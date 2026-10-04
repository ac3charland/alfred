// ALF-250 demo: run swap_code_priority on a throwaway, fully-migrated Postgres and print every
// rank it writes (what the Backlog's realtime stream renders), then two overlapping swaps.
// Run from the repo root: node docs/demos/backlog-priority-swap/swap-demo.ts
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const cluster = await startCluster();
const connect = async () => {
  const client = new pg.Client({ ...cluster });
  await client.connect();
  return client;
};
const db = await connect();
try {
  await bootstrapSupabase(db);
  await applyMigrations(db);
  const quiet = async (sql: string, params: unknown[] = []) => db.query(sql, params);
  await quiet(`insert into projects (id, key, name, repo_owner, repo_name)
    values ('00000000-0000-0000-0000-000000000001', 'ALF', 'Alfred', 'o', 'r')`);
  await quiet(`insert into epics (id, project_id, name, ref_number, ref)
    values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'E', 1, 'ALF-1')`);
  for (const title of ['A', 'B', 'C']) {
    await quiet(`select create_code_story('00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002', $1)`, [title]);
  }
  const ranks = async () =>
    (await db.query(`select ref, priority from code_items order by priority`)).rows
      .map((r) => `${r.ref}=${r.priority}`)
      .join('  ');
  console.log('start:            ', await ranks());

  await quiet('create table swap_writes (ref text, priority double precision)');
  await quiet(`create function log_swap_write() returns trigger language plpgsql as $$
    begin insert into swap_writes values (new.ref, new.priority); return new; end; $$`);
  await quiet(`create trigger log_swap_write after update on code_items
    for each row execute function log_swap_write()`);
  await quiet(`select swap_code_priority('ALF-3', 'ALF-2')`);
  const writes = (await db.query('select ref, priority from swap_writes')).rows;
  console.log('rows written:     ', writes.map((r) => `${r.ref}=${r.priority}`).join('  '));
  await quiet('drop trigger log_swap_write on code_items');

  const other = await connect();
  await db.query('begin');
  await db.query(`select swap_code_priority('ALF-3', 'ALF-2')`);
  const second = other.query(`select swap_code_priority('ALF-3', 'ALF-1')`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await db.query('commit');
  await second.then(
    () => console.log('overlapping swap: ok'),
    (error: Error) => console.log('overlapping swap:', error.message),
  );
  await other.end();
  console.log('end:              ', await ranks());
} finally {
  await db.end();
  cluster.stop();
}
