// Every row write `swap_code_priority` makes, on a throwaway Postgres: the integration suite's
// cluster + migrations, three stories, one swap, and an audit trigger logging each UPDATE — the
// same stream Supabase realtime echoes to the browser.
//
//   node docs/demos/alf-250-priority-swap/swap-writes.mjs <before|after>
//
// `before` stops the migration history short of 0042 (the parked-sentinel swap); `after` applies
// everything.
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase, MIGRATIONS_DIR } from '../../../database/src/migrate.ts';

const mode = process.argv[2];
if (mode !== 'before' && mode !== 'after') throw new Error('usage: swap-writes.mjs <before|after>');

const cluster = await startCluster();
const client = new pg.Client(cluster);
try {
  await client.connect();
  await bootstrapSupabase(client);
  await applyMigrations(client, MIGRATIONS_DIR, (file) =>
    mode === 'after' ? true : !file.includes('0042_swap_priority_in_one_write'),
  );
  await client.query(`set client_min_messages = warning`);
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ('00000000-0000-0000-0000-000000000001', 'ALF', 'Alfred', 'ac3charland', 'alfred')`,
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
               'Epic', 1, 'ALF-1')`,
  );
  for (const title of ['first', 'second', 'third']) {
    await client.query(
      `select create_code_story('00000000-0000-0000-0000-000000000001',
                                '00000000-0000-0000-0000-000000000002', $1)`,
      [title],
    );
  }
  const backlog = async () =>
    (await client.query(`select ref, priority from code_items order by priority`)).rows
      .map((row) => `${row.ref}@${String(row.priority)}`)
      .join('  ');
  console.log(`Backlog:        ${await backlog()}`);

  await client.query(`create table swap_writes (n serial, ref text, priority double precision)`);
  await client.query(`create function log_write() returns trigger language plpgsql as $$
    begin insert into swap_writes (ref, priority) values (new.ref, new.priority); return new; end $$`);
  await client.query(`create trigger log_write after update of priority on code_items
    for each row execute function log_write()`);

  // The Down chevron on the middle story: swap it with the one below.
  const { rows } = await client.query(`select ref from code_items order by priority`);
  const [a, b] = [rows[1].ref, rows[2].ref];
  console.log(`Down on ${a}:   select swap_code_priority('${a}', '${b}')`);
  await client.query(`select swap_code_priority($1, $2)`, [a, b]);

  const writes = await client.query(`select ref, priority from swap_writes order by n`);
  for (const [index, write] of writes.rows.entries()) {
    console.log(`  realtime echo ${String(index + 1)}: ${write.ref} → ${String(write.priority)}`);
  }
  console.log(`Backlog:        ${await backlog()}`);
} finally {
  await client.end();
  cluster.stop();
}
