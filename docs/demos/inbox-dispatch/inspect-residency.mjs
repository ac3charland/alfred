/**
 * Demo harness for the inbox-dispatch migration: stand up a throwaway PostgreSQL, replay the
 * migration history around the residency migration, and print what it did to real rows.
 *
 * The change is a schema change with no visual surface, so its evidence is the database's own
 * answers — a backfill judged against rows that existed before it ran, then each new rule
 * exercised as a real write. Everything printed is derived from `dispatched_at`'s null-ness, never
 * its value, so the output is identical on every run and `npm run demo -- verify` stays green.
 *
 * Run from the repo root: `node docs/demos/inbox-dispatch/inspect-residency.mjs`
 */
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { MIGRATIONS_DIR, applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const DISPATCH_MIGRATION = '0026_inbox_dispatch.sql';
const basename = (file) => file.slice(file.lastIndexOf('/') + 1);

const out = (line) => process.stdout.write(`${line}\n`);

/** `select`, printed as "label → in the Inbox | in <folder>", i.e. the view each row renders in. */
async function showViews(client, heading) {
  const { rows } = await client.query(
    `select i.title,
            i.dispatched_at is null as in_inbox,
            coalesce(f.name, '—')   as folder
       from items i
       left join folders f on f.id = i.folder_id
      order by i.title`,
  );
  out(heading);
  for (const row of rows) {
    out(`  ${row.title.padEnd(24)} folder=${row.folder.padEnd(8)} renders in: ${row.in_inbox ? 'Inbox' : row.folder}`);
  }
}

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

  // ── The world as it stood when "in the Inbox" still meant "has no folder" ──
  await applyMigrations(client, MIGRATIONS_DIR, (f) => basename(f) < DISPATCH_MIGRATION);
  const { rows: folderRows } = await client.query(
    `insert into folders (name) values ('Health') returning id`,
  );
  const health = folderRows[0].id;
  const { rows: filedRows } = await client.query(
    `insert into items (title, item_type, folder_id) values ('Book the check-up', 'task', $1)
       returning id`,
    [health],
  );
  await client.query(
    `insert into items (title, item_type, folder_id, parent_id)
       values ('Find the referral', 'task', $1, $2)`,
    [health, filedRows[0].id],
  );
  await client.query(`insert into items (title, item_type) values ('Call the dentist', 'task')`);

  // ── Apply the migration over exactly those pre-existing rows ──
  await applyMigrations(client, MIGRATIONS_DIR, (f) => basename(f) === DISPATCH_MIGRATION);
  await showViews(client, 'After the backfill — no row changed which view it renders in:');

  // ── The state the column exists to make possible ──
  // A folder written onto an Inbox row without a dispatch — the shape the classifier will
  // produce when it starts guessing where captures belong.
  await client.query(`update items set folder_id = $1 where title = 'Call the dentist'`, [health]);
  out('');
  await showViews(
    client,
    'A folder filled in on an item nobody has triaged — it stays in the Inbox:',
  );

  // ── Insert inheritance, in the database rather than any one caller ──
  const { rows: inserted } = await client.query(
    `insert into items (title, item_type, folder_id)
       values ('Straight into Health', 'task', $1) returning dispatched_at is null as in_inbox`,
    [health],
  );
  const { rows: childRows } = await client.query(
    `insert into items (title, item_type, folder_id, parent_id)
       select 'Subtask of the dentist call', 'task', $1, id
         from items where title = 'Call the dentist'
       returning dispatched_at is null as in_inbox`,
    [health],
  );
  out('');
  out('Residency is filled in at insert, by the database:');
  out(
    `  created inside a folder                     → in the Inbox: ${String(inserted[0].in_inbox)}`,
  );
  out(
    `  created under a parent that is in the Inbox → in the Inbox: ${String(childRows[0].in_inbox)}`,
  );

  // ── The two rules that keep every item reachable from exactly one view ──
  let rejected = 'accepted (!)';
  try {
    await client.query(
      `insert into items (title, item_type, dispatched_at) values ('Nowhere', 'task', now())`,
    );
  } catch (error) {
    rejected = error.constraint ?? String(error);
  }
  out('');
  out(`A task dispatched with no folder would render nowhere → ${rejected}`);

  await client.query(`delete from folders where id = $1`, [health]);
  const { rows: homeless } = await client.query(
    `select count(*)::int as n from items where folder_id is null and dispatched_at is null`,
  );
  out(`Deleting the folder returns all ${String(homeless[0].n)} of its items to the Inbox`);
} finally {
  await client.end();
  cluster.stop();
}
