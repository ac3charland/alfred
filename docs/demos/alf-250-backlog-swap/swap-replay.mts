// Replays the Backlog's single-chevron swap against a throwaway Postgres built from the real
// migrations — once with every migration BEFORE 0042, once with all of them — and prints
// (1) every row version one swap writes, i.e. every realtime UPDATE an open Backlog receives,
// and (2) what happens when two swaps of the same story overlap.
import path from 'node:path';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase, MIGRATIONS_DIR } from '../../../database/src/migrate.ts';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const EPIC = '22222222-2222-2222-2222-222222222222';

async function replay(label: string, include: (file: string) => boolean): Promise<void> {
  const cluster = await startCluster();
  const config = {
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  };
  const admin = new pg.Client(config);
  await admin.connect();
  try {
    await bootstrapSupabase(admin);
    await applyMigrations(admin, MIGRATIONS_DIR, include);
    await admin.query(
      `insert into projects (id, key, name, repo_owner, repo_name)
         values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred')`,
      [PROJECT],
    );
    await admin.query(
      `insert into epics (id, project_id, name, ref_number, ref) values ($1, $2, 'Epic', 1, 'ALF-1')`,
      [EPIC, PROJECT],
    );
    for (const title of ['D', 'C', 'B', 'A']) {
      await admin.query(`select create_code_story($1, $2, $3)`, [PROJECT, EPIC, title]);
    }
    const ranks = async () =>
      (
        await admin.query<{ ref: string; priority: number }>(
          `select ref, priority from code_items order by priority`,
        )
      ).rows
        .map((r) => `${r.ref}=${String(r.priority)}`)
        .join('  ');

    console.log(`\n== ${label} ==`);
    console.log(`Backlog before:  ${await ranks()}`);

    // (1) Every write one swap makes (ALF-4 nudged Down past ALF-3).
    await admin.query(`create table swap_writes (n serial, ref text, priority double precision)`);
    await admin.query(
      `create function record_swap_write() returns trigger language plpgsql as $$
       begin insert into swap_writes (ref, priority) values (new.ref, new.priority); return new; end; $$`,
    );
    await admin.query(
      `create trigger record_swap_write after update on code_items
         for each row execute function record_swap_write()`,
    );
    await admin.query(`select swap_code_priority('ALF-4', 'ALF-3')`);
    const writes = await admin.query<{ ref: string; priority: number }>(
      `select ref, priority from swap_writes order by n`,
    );
    console.log('Realtime UPDATEs one Down click sends the browser:');
    for (const w of writes.rows) console.log(`  ${w.ref} -> ${String(w.priority)}`);
    await admin.query(`drop trigger record_swap_write on code_items`);
    console.log(`Backlog after:   ${await ranks()}`);

    // (2) Two overlapping syncs of the same story: ALF-4 Down past ALF-2 while a second sync
    // moves it on past ALF-1 before the first has committed.
    const first = new pg.Client(config);
    const second = new pg.Client(config);
    await first.connect();
    await second.connect();
    try {
      await first.query('set role authenticated');
      await second.query('set role authenticated');
      await first.query('begin');
      await first.query(`select swap_code_priority('ALF-4', 'ALF-2')`);
      const overlapping = second
        .query(`select swap_code_priority('ALF-4', 'ALF-1')`)
        .then(() => 'ok')
        .catch((error: unknown) => `ERROR: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query('commit');
      console.log(`Overlapping second swap:  ${await overlapping}`);
    } finally {
      await first.end();
      await second.end();
    }
    console.log(`Backlog after both:  ${await ranks()}`);
  } finally {
    await admin.end();
    cluster.stop();
  }
}

await replay('before 0042 (main)', (file) => path.basename(file) < '0042');
await replay('with 0042_atomic_priority_swap.sql', () => true);
