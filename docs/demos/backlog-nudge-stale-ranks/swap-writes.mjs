// Show what one Backlog nudge (`swap_code_priority`) writes, against a REAL throwaway
// PostgreSQL — every row-level write, which is exactly what Realtime streams to the browser —
// first with the migrations BEFORE 0042, then with 0042 applied. Then two swaps of the same story
// in flight at once. Prints a fixed, deterministic transcript.
import path from 'node:path';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { MIGRATIONS_DIR, applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const FIX = '0042_swap_priority_in_one_write.sql';
const PROJECT = '11111111-1111-1111-1111-111111111111';
const EPIC = '22222222-2222-2222-2222-222222222222';

const cluster = await startCluster();
const connection = {
  host: cluster.host,
  port: cluster.port,
  user: cluster.user,
  database: cluster.database,
};
const client = new pg.Client(connection);
const say = (line = '') => process.stdout.write(`${line}\n`);

async function story(title) {
  const { rows } = await client.query(
    `select ref, priority from create_code_story($1, $2, $3)`,
    [PROJECT, EPIC, title],
  );
  return rows[0];
}

async function showNudge() {
  const a = await story('nudged story');
  const b = await story('its neighbour');
  say(`before: ${a.ref}=${a.priority}, ${b.ref}=${b.priority}`);
  await client.query(`truncate write_log`);
  await client.query(`select swap_code_priority($1, $2)`, [a.ref, b.ref]);
  const { rows } = await client.query(`select ref, priority from write_log order by seq`);
  say(`row writes streamed to the browser, in order:`);
  for (const row of rows) say(`  ${row.ref} → ${row.priority}`);
}

async function showConcurrentNudges() {
  const s = await story('nudged twice');
  const first = await story('first neighbour');
  const second = await story('second neighbour');
  const other = new pg.Client(connection);
  await other.connect();
  const { rows: pids } = await other.query('select pg_backend_pid() as pid');
  try {
    await client.query('begin');
    await client.query(`select swap_code_priority($1, $2)`, [s.ref, first.ref]);
    const pending = other
      .query(`select swap_code_priority($1, $2)`, [s.ref, second.ref])
      .then(() => 'committed')
      .catch((error) => `FAILED: ${error.message}`);
    // Commit only once the second swap is blocked on the row the first still holds.
    for (;;) {
      const { rows } = await client.query(
        `select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1`,
        [pids[0].pid],
      );
      if (rows[0]?.waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await client.query('commit');
    say(`${s.ref}↔${first.ref} committed; ${s.ref}↔${second.ref} (in flight at the same time): ${await pending}`);
  } finally {
    await other.end();
  }
}

try {
  await client.connect();
  await bootstrapSupabase(client);
  await applyMigrations(client, MIGRATIONS_DIR, (file) => path.basename(file) < FIX);
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred')`,
    [PROJECT],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref) values ($1, $2, 'Backlog', 1, 'ALF-1')`,
    [EPIC, PROJECT],
  );
  // Log every write to a rank — one line per Realtime UPDATE event the browser would receive.
  await client.query(`create table write_log (seq serial, ref text, priority double precision)`);
  await client.query(
    `create function log_write() returns trigger language plpgsql as $$
     begin insert into write_log (ref, priority) values (new.ref, new.priority); return new; end; $$`,
  );
  await client.query(
    `create trigger log_write after update of priority on code_items
       for each row execute function log_write()`,
  );

  say('== BEFORE 0042 ==');
  await showNudge();
  await showConcurrentNudges();

  await applyMigrations(client, MIGRATIONS_DIR, (file) => path.basename(file) === FIX);
  say();
  say('== AFTER 0042 ==');
  await showNudge();
  await showConcurrentNudges();
} finally {
  await client.end();
  cluster.stop();
}
