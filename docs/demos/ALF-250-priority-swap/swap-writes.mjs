// Boot a throwaway Postgres, apply the migrations — every one, or all but the ones named on the
// command line — swap two stories' Backlog priority the way the chevron does, and print every row
// change the swap made. Realtime publishes `code_items`, so these are exactly the updates an open
// Backlog is sent.
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const leftOut = process.argv.slice(2);
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
  await applyMigrations(client, undefined, (file) => !leftOut.some((name) => file.includes(name)));
  await client.query(`
    insert into projects (id, key, name, repo_owner, repo_name)
      values ('00000000-0000-4000-8000-000000000001', 'ALF', 'Alfred', 'ac3charland', 'alfred');
    create table demo_writes (n serial, ref text, priority double precision);
    create function demo_log_write() returns trigger language plpgsql security definer as $$
      begin insert into demo_writes (ref, priority) values (new.ref, new.priority); return new; end $$;
    create trigger demo_log_write after update of priority on code_items
      for each row execute function demo_log_write();
  `);
  const epic = await client.query(
    `select id from create_epic('00000000-0000-4000-8000-000000000001', 'Reader')`,
  );
  await client.query('set role authenticated');
  for (const title of ['Weekly plan items', 'Send a Reader post to Instapaper']) {
    await client.query(`select create_code_story($1, $2, $3)`, [
      '00000000-0000-4000-8000-000000000001',
      epic.rows[0].id,
      title,
    ]);
  }
  const before = await client.query(`select ref, priority from code_items order by priority`);
  console.log(`Backlog: ${before.rows.map((row) => `${row.ref} @ ${row.priority}`).join(', ')}`);
  console.log(`Nudge ${before.rows[0].ref} down: swap_code_priority('${before.rows[0].ref}', '${before.rows[1].ref}')`);
  await client.query(`select swap_code_priority($1, $2)`, [before.rows[0].ref, before.rows[1].ref]);
  await client.query('reset role');
  const writes = await client.query(`select ref, priority from demo_writes order by n`);
  console.log('Row changes Realtime broadcasts:');
  for (const [index, row] of writes.rows.entries()) {
    console.log(`  ${index + 1}. ${row.ref} → ${row.priority}`);
  }
} finally {
  await client.end();
  cluster.stop();
}
