// Stand up a throwaway Postgres with the real migrations — once through 0041 (the swap as it
// was) and once through 0042 — and print what `swap_code_priority` writes. Every row version
// printed is a change event `supabase_realtime` broadcasts to an open Backlog.
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const EPIC = '22222222-2222-2222-2222-222222222222';

async function run(label: string, include: (file: string) => boolean): Promise<void> {
  const cluster = await startCluster();
  const config = { host: cluster.host, port: cluster.port, user: cluster.user, database: cluster.database };
  const client = new pg.Client(config);
  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client, undefined, include);
    await client.query(
      `insert into projects (id, key, name, repo_owner, repo_name) values ($1, 'ALF', 'Alfred', 'o', 'r')`,
      [PROJECT],
    );
    await client.query(
      `insert into epics (id, project_id, name, ref_number, ref) values ($1, $2, 'Epic', 1, 'ALF-1')`,
      [EPIC, PROJECT],
    );
    for (const title of ['one', 'two', 'three', 'four']) {
      await client.query(`select create_code_story($1, $2, $3)`, [PROJECT, EPIC, title]);
    }
    const ranks = async () =>
      (await client.query<{ ref: string; priority: number }>(
        `select ref, priority from code_items order by priority`,
      )).rows.map((r) => `${r.ref}=${String(r.priority)}`).join('  ');

    console.log(`== ${label}`);
    console.log(`Backlog before:  ${await ranks()}`);
    await client.query(`create table swap_log (seq serial, ref text, priority double precision)`);
    await client.query(`create function log_swap() returns trigger language plpgsql security definer as $$
      begin insert into swap_log (ref, priority) values (new.ref, new.priority); return new; end; $$`);
    await client.query(`create trigger swap_log after update on code_items for each row execute function log_swap()`);

    // One Down click on the top story, ALF-4, swapping it with ALF-3 below.
    await client.query(`set role authenticated`);
    await client.query(`select swap_code_priority('ALF-4', 'ALF-3')`);
    await client.query(`reset role`);
    const { rows } = await client.query<{ ref: string; priority: number }>(
      `select ref, priority from swap_log order by seq`,
    );
    console.log('Row versions broadcast, in order:');
    for (const r of rows) console.log(`  ${r.ref} -> ${String(r.priority)}`);
    await client.query(`drop trigger swap_log on code_items`);

    // Two overlapping swaps of the same story: the next burst commits while one is in flight.
    const first = new pg.Client(config);
    const second = new pg.Client(config);
    await first.connect();
    await second.connect();
    try {
      await first.query('begin');
      await first.query(`select swap_code_priority('ALF-4', 'ALF-2')`);
      const overlapping = second.query(`select swap_code_priority('ALF-4', 'ALF-1')`).then(
        () => 'landed',
        (error: unknown) => `failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query('commit');
      console.log(`Overlapping second swap: ${await overlapping}`);
    } finally {
      await first.end();
      await second.end();
    }
    console.log(`Backlog after:   ${await ranks()}`);
  } finally {
    await client.end();
    cluster.stop();
  }
}

await run('swap_code_priority through 0041 (before)', (file) => !file.includes('0042_'));
console.log('');
await run('swap_code_priority with 0042 (after)', () => true);
