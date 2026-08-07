/**
 * Demo harness for the backup verify step's schema-drift handling.
 *
 * Replays the 2026-08-07 red backup run against real PostgreSQL: a PRODUCTION database that has
 * already been migrated (it has `items.dispatched_at`) dumped into a VERIFY database rebuilt from
 * a repo whose migrations stop one short — exactly the window between applying a migration to the
 * live database and committing it. First the old load, which aborts; then the same dump through
 * the new drift path, which names the drift, gives the data somewhere to land, and restores it.
 *
 * The change has no visual surface, so the evidence is the restore's own answers. Everything
 * printed is derived — exit codes, the ERROR line, drift descriptions, row counts — never a
 * timestamp, port, path, or generated id, so the output is identical on every run and
 * `npm run demo -- verify` stays green.
 *
 * Run from the repo root: `node docs/demos/backup-schema-drift/replay-backup-verify.mjs`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

import {
  backupExitCode,
  copiedTables,
  describeSchemaDrift,
  reconcileDriftStatements,
  schemaDrift,
} from '../../../database/src/backup.ts';
import { startCluster } from '../../../database/src/cluster.ts';
import {
  MIGRATIONS_DIR,
  applyMigrations,
  bootstrapSupabase,
} from '../../../database/src/migrate.ts';

/** The migration production had applied and the repo had not — the split point of the whole story. */
const DRIFTED_MIGRATION = '0026_inbox_dispatch.sql';
const CORE_TABLES = ['items', 'folders', 'projects'];

const out = (line) => process.stdout.write(`${line}\n`);

/** `pg_dump` isn't always on PATH — Debian/Ubuntu keep it under /usr/lib/postgresql/<major>/bin. */
function pgDumpPath() {
  const onPath = spawnSync('bash', ['-c', 'command -v pg_dump'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim().length > 0) return onPath.stdout.trim();
  const base = '/usr/lib/postgresql';
  const majors = existsSync(base)
    ? readdirSync(base).map((entry) => Number.parseInt(entry, 10))
    : [];
  const newest = Math.max(-1, ...majors.filter((major) => Number.isFinite(major)));
  return newest >= 0 ? path.join(base, String(newest), 'bin', 'pg_dump') : 'pg_dump';
}

async function connect(cluster) {
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  await client.connect();
  return client;
}

const url = (cluster) => `postgres://${cluster.user}@${cluster.host}:${cluster.port}/postgres`;

/** The public schema's base-table columns, keyed by table — what the verifier can actually hold. */
async function publicColumns(client) {
  const { rows } = await client.query(
    `select c.table_name, c.column_name from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
  );
  const columns = new Map();
  for (const row of rows) {
    const existing = columns.get(row.table_name);
    if (existing === undefined) columns.set(row.table_name, [row.column_name]);
    else existing.push(row.column_name);
  }
  return columns;
}

/**
 * The nightly's real load command. Returns the exit code and the ERROR line only — psql's other
 * chatter carries version-specific wording, and the ERROR is the whole point anyway.
 */
function loadDump(verifyUrl, dataPath) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      `{ printf 'set session_replication_role = replica;\\n'; cat ${dataPath}; } | ` +
        `psql "${verifyUrl}" -v ON_ERROR_STOP=1 --single-transaction --quiet`,
    ],
    { encoding: 'utf8' },
  );
  const error = result.stderr
    .split('\n')
    .find((line) => line.startsWith('ERROR:'))
    ?.trim();
  return { status: result.status, error };
}

const work = mkdtempSync(path.join(tmpdir(), 'alfred-demo-drift-'));
const dataPath = path.join(work, 'data.sql');
const production = await startCluster();
const verify = await startCluster();

try {
  // ── Production: every migration, including the one the repo hasn't got ──────────────────────
  const productionClient = await connect(production);
  await bootstrapSupabase(productionClient);
  await applyMigrations(productionClient);
  const { rows: folder } = await productionClient.query(
    `insert into folders (name) values ('Health') returning id`,
  );
  await productionClient.query(
    `insert into items (title, item_type, folder_id) values ('filed task', 'task', $1)`,
    [folder[0].id],
  );
  await productionClient.query(`insert into items (title, item_type) values ('a capture', 'task')`);
  await productionClient.query(
    `insert into projects (key, name, repo_owner, repo_name)
       values ('ALF', 'Alfred', 'ac3charland', 'alfred')`,
  );
  await productionClient.end();

  // ── The verify database, rebuilt from a repo one migration behind ───────────────────────────
  const verifyClient = await connect(verify);
  await bootstrapSupabase(verifyClient);
  await applyMigrations(
    verifyClient,
    MIGRATIONS_DIR,
    (file) => path.basename(file) < DRIFTED_MIGRATION,
  );

  out(`production has been migrated through ${DRIFTED_MIGRATION}; the repo stops one short.`);
  const present = await publicColumns(verifyClient);
  out(`  production items.dispatched_at : yes`);
  out(
    `  verifier   items.dispatched_at : ${present.get('items').includes('dispatched_at') ? 'yes' : 'no'}`,
  );

  spawnSync(
    'bash',
    ['-c', `${pgDumpPath()} "${url(production)}" --data-only --schema public -f ${dataPath}`],
    { encoding: 'utf8' },
  );

  // ── 1. What the nightly did before: a sound dump, refused ───────────────────────────────────
  out('\n── before: the load the backup used to run ─────────────────────────────────');
  const before = loadDump(url(verify), dataPath);
  out(`  psql exit code : ${before.status}`);
  out(`  psql says      : ${before.error}`);
  out('  → the job died here, so the dump was never uploaded. No backup that day.');

  // ── 2. The drift is named rather than hit ───────────────────────────────────────────────────
  out('\n── after: the verify step inspects the dump first ──────────────────────────');
  const drift = schemaDrift(copiedTables(readFileSync(dataPath, 'utf8')), present);
  out(`  ⚠ ${describeSchemaDrift(drift)}`);
  out('\n  reconciling the throwaway so the payload has somewhere to land:');
  for (const statement of reconcileDriftStatements(drift)) {
    out(`    ${statement}`);
    await verifyClient.query(statement);
  }

  // ── 3. The same dump, now restored and counted ──────────────────────────────────────────────
  const after = loadDump(url(verify), dataPath);
  out(`\n  psql exit code : ${after.status}`);
  for (const table of CORE_TABLES) {
    const { rows } = await verifyClient.query(`select count(*)::int as n from ${table}`);
    out(`  ${table}: ${rows[0].n} rows restored`);
  }
  const { rows: dispatched } = await verifyClient.query(
    `select count(*)::int as n from items where dispatched_at is not null`,
  );
  out(`  …including ${dispatched[0].n} row whose dispatched_at came through the drifted column.`);
  out('  → the dump is verified and uploaded; the run still exits non-zero (see below).');

  // ── 4. The other direction stays silent ─────────────────────────────────────────────────────
  out('\n── the reverse case: a dump SHORT of the repo is normal, not drift ─────────');
  out('  (the two instances migrate independently — `work` regularly lags `personal`)');
  const shortDump = 'COPY public.items (id, title) FROM stdin;\n\\.\n';
  const reverse = schemaDrift(copiedTables(shortDump), await publicColumns(verifyClient));
  out(`  drift reported : ${reverse.length === 0 ? 'none — the backup stays green' : 'DRIFT'}`);

  // ── 5. Uploaded is not the same as green ────────────────────────────────────────────────────
  out('\n── the run’s exit code: a saved backup does not excuse a stale repo ────────');
  out(`  after this drifted run     : ${backupExitCode(drift)} (red — GitHub emails the owner)`);
  out(`  once the migration is in   : ${backupExitCode(reverse)} (green)`);

  await verifyClient.end();
} finally {
  production.stop();
  verify.stop();
  rmSync(work, { recursive: true, force: true });
}
