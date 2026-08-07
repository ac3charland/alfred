// Drives the REAL merge-pipeline applier (`database/src/deploy.ts`, the command
// `.github/workflows/migrate.yml` runs) against throwaway PostgreSQL databases standing in for the
// two Supabase instances. Nothing here is a stub: the same CLI, the same SQL, the same ledger.
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
import { BASELINE_MIGRATION, recordManualApply } from '../../../database/src/deploy.ts';
import {
  MIGRATIONS_DIR,
  applyMigrations,
  bootstrapSupabase,
} from '../../../database/src/migrate.ts';

const DEPLOY_CLI = path.resolve(import.meta.dirname, '../../../database/src/deploy.ts');

/** The pending migration this demo pretends just merged. */
const PENDING = '0027_items_source_url_index.sql';
const PENDING_SQL = `-- ALF-177 demo: a perfectly ordinary migration merging to main.
create index if not exists items_source_url_idx on items (source_url);
`;

function heading(text) {
  const rule = '─'.repeat(Math.max(3, 74 - text.length));
  console.log(`\n── ${text} ${rule}`);
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
  const port = new URL(url).port;
  const mask = (text) => text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:<port>').trimEnd();
  if (result.stdout.trim()) console.log(mask(result.stdout));
  if (result.stderr.trim()) console.log(mask(result.stderr));
  return result.status;
}

/** Create a database on the cluster and return its connection URL. */
async function createDatabase(cluster, name) {
  const admin = new pg.Client({ ...cluster, database: cluster.database });
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

/** Stand a database up the way the live ones look today: full history by hand, no ledger. */
async function seedLiveDatabase(cluster, name) {
  const url = await createDatabase(cluster, name);
  await withClient(url, async (client) => {
    await bootstrapSupabase(client);
    await applyMigrations(client, MIGRATIONS_DIR, (file) => path.basename(file) <= BASELINE_MIGRATION);
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
    const listed = rows.map((row) => row.filename).reverse();
    const { rows: counted } = await client.query(
      'select count(*)::int as n from public.schema_migrations',
    );
    console.log(`${label}: ${counted[0].n} rows, last ${String(listed.length)} —`);
    for (const name of listed) console.log(`  ${name}`);
  });
}

const cluster = await startCluster();
const migrations = scratchMigrations();
try {
  // Both instances start where Personal and Work actually are: the whole committed history applied
  // by hand, and no ledger table — nothing has ever recorded what they've seen.
  const personal = await seedLiveDatabase(cluster, 'alfred_personal');
  const work = await seedLiveDatabase(cluster, 'alfred_work');

  // …except that on Work, the operator already ran `npm run migrate` for the new migration before
  // the PR merged — the habit the pipeline is replacing.
  await withClient(work, async (client) => {
    await client.query(PENDING_SQL);
    await recordManualApply(client, PENDING, migrations);
  });

  heading(`a merge adds ${PENDING}; what is pending, per instance`);
  runDeploy(personal, 'personal', migrations, '--dry-run');
  runDeploy(work, 'work', migrations, '--dry-run');

  heading('the workflow runs — one job per instance');
  runDeploy(personal, 'personal', migrations);
  runDeploy(work, 'work', migrations);

  heading('each database now records its own history');
  await showLedger(personal, 'personal');
  await showLedger(work, 'work');

  heading('the index the migration created is really there (personal)');
  await withClient(personal, async (client) => {
    const { rows } = await client.query(
      `select indexname from pg_indexes where indexname = 'items_source_url_idx'`,
    );
    console.log(rows.length === 1 ? `  ${rows[0].indexname}` : '  MISSING');
  });

  heading('the next merge, with nothing new to apply');
  runDeploy(personal, 'personal', migrations);
  runDeploy(work, 'work', migrations);

  heading('a broken migration fails the job instead of half-landing');
  writeFileSync(
    path.join(migrations, '0028_broken.sql'),
    'create table wont_survive (id int);\nalter table items add column does_not_exist_ref uuid references nope (id);\n',
  );
  const code = runDeploy(personal, 'personal', migrations);
  console.log(`exit code: ${code}`);
  await withClient(personal, async (client) => {
    const { rows } = await client.query(
      `select to_regclass('public.wont_survive') is null as rolled_back,
              (select count(*)::int from public.schema_migrations where filename = '0028_broken.sql') as recorded`,
    );
    console.log(`rolled back: ${rows[0].rolled_back}, ledger rows for it: ${rows[0].recorded}`);
  });
} finally {
  cluster.stop();
}
