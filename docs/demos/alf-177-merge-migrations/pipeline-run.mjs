// Drives the REAL merge-pipeline applier (`database/src/deploy.ts`, the command
// `.github/workflows/migrate.yml` runs) against throwaway PostgreSQL databases. Nothing here is a
// stub: the same CLI, the same SQL, the same ledger.
//
// The scratch migration set is `database/migrations` plus one new file, so the run shows a merge
// actually landing something. Output is normalized (the cluster's random port) so `demo verify`
// reproduces it exactly.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { recordManualApply } from '../../../database/src/deploy.ts';
import {
  MIGRATIONS_DIR,
  applyMigrations,
  bootstrapSupabase,
  migrationFiles,
} from '../../../database/src/migrate.ts';

const DEPLOY_CLI = path.resolve(import.meta.dirname, '../../../database/src/deploy.ts');

/** The pending migration this demo pretends just merged. */
const PENDING = '0027_items_source_url_index.sql';
const PENDING_SQL = `-- ALF-177 demo: a perfectly ordinary migration merging to main.
create index if not exists items_source_url_idx on items (source_url);
`;

/** Where the Work database really stood: everything through 0017, and nothing after. */
const WORK_STOOD_AT = '0017_grant_v_code_stories.sql';

function heading(text) {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(3, 74 - text.length))}`);
}

/** A scratch migration set: every committed migration, plus the one that "just merged". */
function scratchMigrations() {
  const dir = mkdtempSync(path.join(tmpdir(), 'alfred-demo-migrations-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  writeFileSync(path.join(dir, PENDING), PENDING_SQL);
  return dir;
}

/**
 * Run the deploy CLI exactly as the workflow does, and echo its output with the cluster's random
 * port masked. Returns the exit code so a failing run is visible as the workflow would see it.
 */
function runDeploy(url, instance, migrationsDir, ...args) {
  const result = spawnSync('node', ['--no-warnings', DEPLOY_CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_DB_URL: url,
      INSTANCE: instance,
      ALFRED_MIGRATIONS_DIR: migrationsDir,
    },
  });
  const { port } = new URL(url);
  const mask = (text) => text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:<port>').trimEnd();
  if (result.stdout.trim()) console.log(mask(result.stdout));
  if (result.stderr.trim()) console.log(mask(result.stderr));
  return result.status;
}

/** Create a database on the cluster and return its connection URL. */
async function createDatabase(cluster, name) {
  const admin = new pg.Client({ ...cluster });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  return `postgres://${cluster.user}@${cluster.host}:${cluster.port}/${name}`;
}

/** Connect, run `fn`, disconnect. */
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** A database carrying history up to `upTo` by hand, with no ledger — an unadopted database. */
async function seedUnadopted(cluster, name, upTo) {
  const url = await createDatabase(cluster, name);
  await withClient(url, async (client) => {
    await bootstrapSupabase(client);
    await applyMigrations(client, MIGRATIONS_DIR, (file) => path.basename(file) <= upTo);
  });
  return url;
}

/** Print the tail of a database's ledger — filenames only, so the output is stable. */
async function showLedger(url, label, limit = 3) {
  await withClient(url, async (client) => {
    const { rows } = await client.query(
      `select filename from public.schema_migrations order by filename desc limit $1`,
      [limit],
    );
    const { rows: counted } = await client.query(
      'select count(*)::int as n from public.schema_migrations',
    );
    console.log(`${label}: ${counted[0].n} rows, last ${limit} —`);
    for (const name of rows.map((row) => row.filename).reverse()) console.log(`  ${name}`);
  });
}

const cluster = await startCluster();
const migrations = scratchMigrations();
const newest = migrationFiles(MIGRATIONS_DIR).map((f) => path.basename(f)).at(-1);
try {
  // Both instances start unadopted: history applied by hand over the years, no ledger. And — the
  // thing that made this ticket bite — they are NOT at the same point. Work was nine behind.
  const personal = await seedUnadopted(cluster, 'alfred_personal', newest);
  const work = await seedUnadopted(cluster, 'alfred_work', WORK_STOOD_AT);

  heading('an unadopted database: the deployer refuses to guess what it has');
  const refused = runDeploy(work, 'work', migrations);
  console.log(`exit code: ${refused}`);
  await withClient(work, async (client) => {
    const { rows } = await client.query(
      `select to_regclass('public.schema_migrations') is null
              or (select count(*) from public.schema_migrations) = 0 as wrote_nothing`,
    );
    console.log(`wrote nothing: ${rows[0].wrote_nothing}`);
  });

  // Adoption happens against the committed set as it stands today — before the new migration
  // merges — which is exactly how it was done against the two live databases.
  heading('adoption: one command, at the point the operator VERIFIED');
  runDeploy(personal, 'personal', MIGRATIONS_DIR, '--baseline', newest);
  runDeploy(work, 'work', MIGRATIONS_DIR, '--baseline', WORK_STOOD_AT);

  heading('each database now records its own history');
  await showLedger(personal, 'personal');
  await showLedger(work, 'work');

  heading(`a merge adds ${PENDING} — what is pending, per instance`);
  runDeploy(personal, 'personal', migrations, '--dry-run');
  runDeploy(work, 'work', migrations, '--dry-run');

  heading('the workflow runs — one job per instance');
  runDeploy(personal, 'personal', migrations);
  runDeploy(work, 'work', migrations);

  heading('the index the migration created is really there, on both');
  for (const [label, url] of [
    ['personal', personal],
    ['work', work],
  ]) {
    await withClient(url, async (client) => {
      const { rows } = await client.query(
        `select indexname from pg_indexes where indexname = 'items_source_url_idx'`,
      );
      console.log(`  ${label}: ${rows.length === 1 ? rows[0].indexname : 'MISSING'}`);
    });
  }

  heading('the next merge, with nothing new to apply');
  runDeploy(personal, 'personal', migrations);
  runDeploy(work, 'work', migrations);

  heading('a hand-applied migration is skipped, not run twice');
  const extra = '0028_items_notes_index.sql';
  writeFileSync(
    path.join(migrations, extra),
    'create index if not exists items_notes_idx on items (notes);\n',
  );
  await withClient(personal, async (client) => {
    await client.query('create index if not exists items_notes_idx on items (notes);');
    await recordManualApply(client, extra);
  });
  console.log(`(applied ${extra} by hand on personal)`);
  runDeploy(personal, 'personal', migrations);

  heading('a broken migration fails the job instead of half-landing');
  writeFileSync(
    path.join(migrations, '0029_broken.sql'),
    'create table wont_survive (id int);\nalter table items add column does_not_exist_ref uuid references nope (id);\n',
  );
  const code = runDeploy(work, 'work', migrations);
  console.log(`exit code: ${code}`);
  await withClient(work, async (client) => {
    const { rows } = await client.query(
      `select to_regclass('public.wont_survive') is null as rolled_back,
              (select count(*)::int from public.schema_migrations where filename = '0029_broken.sql') as recorded`,
    );
    console.log(`rolled back: ${rows[0].rolled_back}, ledger rows for it: ${rows[0].recorded}`);
  });
} finally {
  cluster.stop();
}
