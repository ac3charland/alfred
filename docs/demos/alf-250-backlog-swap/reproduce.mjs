// Show every row write a Backlog chevron swap makes — the stream realtime replays to the browser.
//
// Stands up the same throwaway Postgres the integration suite uses, TWICE: once without 0042
// (the swap as production ran it) and once with it. Both runs seed three stories, log each write
// to `code_items.priority` with a trigger, and swap the bottom two — one Down click.
//
//   node docs/demos/alf-250-backlog-swap/reproduce.mjs
//
// No credentials, no network: the cluster is created and torn down here.
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EPIC = '22222222-2222-4222-8222-222222222222';

async function run(label, include) {
  const cluster = await startCluster();
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  console.log(`\n── ${label} ──`);
  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client, undefined, include);
    await client.query(
      `insert into projects (id, key, name, repo_owner, repo_name)
         values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred')`,
      [PROJECT],
    );
    await client.query(
      `insert into epics (id, project_id, name, ref_number, ref) values ($1, $2, 'Epic', 1, 'ALF-1')`,
      [EPIC, PROJECT],
    );
    for (const title of ['first', 'second', 'third']) {
      await client.query(`select create_code_story($1, $2, $3)`, [PROJECT, EPIC, title]);
    }
    const backlog = async () =>
      (await client.query(`select ref, priority::text as p from code_items order by priority`)).rows
        .map((r) => `${r.ref}=${r.p}`)
        .join('  ');
    console.log(`  Backlog:       ${await backlog()}`);

    await client.query(`create table swap_writes (n serial, ref text, priority double precision)`);
    await client.query(`
      create function log_swap_write() returns trigger language plpgsql security definer as $$
      begin insert into swap_writes (ref, priority) values (new.ref, new.priority); return new; end; $$`);
    await client.query(`
      create trigger log_swap_write after update of priority on code_items
        for each row execute function log_swap_write()`);

    const [, middle, last] = (await client.query(`select ref from code_items order by priority`))
      .rows;
    console.log(`  Down on ${middle.ref} → swap_code_priority('${middle.ref}', '${last.ref}')`);
    await client.query(`set role authenticated`);
    await client.query(`select swap_code_priority($1, $2)`, [middle.ref, last.ref]);
    await client.query(`reset role`);
    const writes = await client.query(`select ref, priority::text as p from swap_writes order by n`);
    for (const [i, w] of writes.rows.entries()) console.log(`  write ${i + 1}: ${w.ref} → ${w.p}`);
    console.log(`  Backlog:       ${await backlog()}`);
  } finally {
    await client.end();
    cluster.stop();
  }
}

await run('without 0042 (production)', (file) => !file.endsWith('0042_swap_priority_single_write.sql'));
await run('with 0042', () => true);
