/**
 * Exercise the due-time migration against a throwaway Postgres built from every committed
 * migration — the same cluster the database integration suite stands up, so no credentials and
 * nothing real is touched. Prints each rule's observable outcome.
 *
 *   node docs/demos/due-times/db-rules.ts
 */
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const cluster = await startCluster();
const db = new pg.Client({
  host: cluster.host,
  port: cluster.port,
  user: cluster.user,
  database: cluster.database,
});

async function one(sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  const { rows } = await db.query(sql, params);
  return rows[0] ?? {};
}

/** One row as compact JSON, so each outcome reads on one line. */
async function show(sql: string, params: unknown[] = []): Promise<string> {
  return JSON.stringify(await one(sql, params));
}

async function task(fields: string, values: string): Promise<string> {
  const row = await one(`insert into items (title, item_type${fields}) values ('t', 'task'${values}) returning id`);
  return String(row['id']);
}

try {
  await db.connect();
  await bootstrapSupabase(db);
  await applyMigrations(db);
  await db.query('set role authenticated');

  console.log('1. A time with no date is refused:');
  const undated = await task('', '');
  await db.query(`update items set due_time = '15:00' where id = $1`, [undated]).catch((error: Error) => {
    console.log(`   ${error.message}`);
  });

  console.log('2. Moving the date keeps the time; clearing it clears both:');
  const timed = await task(', due_date, due_time', `, '2026-10-03', '15:00'`);
  await db.query(`update items set due_date = '2026-10-05' where id = $1`, [timed]);
  console.log('   after a move :', await show(`select due_date::date::text as date, due_time::text as time from task_items where id = $1`, [timed]));
  await db.query(`update items set due_date = null where id = $1`, [timed]);
  console.log('   after a clear:', await show(`select due_date, due_time from task_items where id = $1`, [timed]));

  console.log('3. Sending a timed task to the factory succeeds and drops the time with the date:');
  await db.query('reset role');
  await db.query(`insert into projects (id, key, name, repo_owner, repo_name) values ('11111111-1111-1111-1111-111111111111', 'ALF', 'Alfred', 'o', 'r')`);
  await db.query(`insert into epics (id, project_id, name, ref_number, ref) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Bug Fixes', 4, 'ALF-4')`);
  await db.query('set role authenticated');
  const gated = await task(', due_date, due_time', `, '2026-10-03', '09:30'`);
  await db.query(`select enter_code_module($1, '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')`, [gated]);
  console.log('  ', await show(`select item_type, due_date, due_time from items where id = $1`, [gated]));

  console.log('4. Completing a recurring timed task spawns the next occurrence at the same time:');
  const recurring = await task(', due_date, due_time, recurrence', `, '2026-10-03', '15:00', '{"freq":"daily","interval":1}'`);
  const spawn = await one(`select complete_and_spawn($1, '2026-10-04', 2) -> 'spawned' as spawned`, [recurring]);
  const spawned = spawn['spawned'] as { due_date: string; due_time: string };
  console.log(`   next occurrence: ${spawned.due_date.slice(0, 10)} at ${spawned.due_time}`);

  console.log('5. A human time edit claims an unjudged row from the classifier:');
  const unjudged = await task(', due_date', `, '2026-10-03'`);
  await db.query(`update items set due_time = '10:00' where id = $1`, [unjudged]);
  console.log('   claimed:', (await one(`select classified_at is not null as claimed from items where id = $1`, [unjudged]))['claimed']);

  console.log('6. Dispatching a row whose guessed time was changed logs a due_time correction:');
  await db.query('reset role');
  const folder = String((await one(`insert into folders (name) values ('Health') returning id`))['id']);
  const judged = String(
    (
      await one(
        `insert into items (title, item_type, due_date, due_time, classified_at, classified_provider,
                            classified_model, classified_prompt_version, classified_guess)
           values ('dentist tomorrow at 3pm', 'task', '2026-10-04', '16:30', now(), 'anthropic',
                   'claude-haiku-4-5', 5, $1) returning id`,
        [JSON.stringify({ item_type: 'task', due_date: '2026-10-04', due_time: '15:00' })],
      )
    )['id'],
  );
  await db.query(`update items set folder_id = $1, dispatched_at = now() where id = $2`, [folder, judged]);
  console.log('  ', await show(`select field, direction, guessed_value, chosen_value from classification_corrections where item_id = $1`, [judged]));
} finally {
  await db.end();
  cluster.stop();
}
