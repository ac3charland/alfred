import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

import { applyMigrations, bootstrapSupabase } from './migrate.ts';

const { Client } = pg;

/**
 * The application tables a restored dump MUST contain to count as structurally sound. These are the
 * user's irreplaceable state (tasks, their folders, the code factory's projects); if a dump restores
 * without them it silently lost the payload, so the nightly refuses to upload it. Kept small and
 * central so the verify assertion and its unit test share one list.
 */
export const CORE_TABLES = ['items', 'folders', 'projects'] as const;

/**
 * Floor (bytes) for a plausible gzipped dump. An empty/truncated dump gzips to a few dozen bytes;
 * even a schema-only dump of this database is many KB. 512 sits safely between, so anything smaller
 * is a failed dump we must not verify or upload. Overridable per call for tests.
 */
export const MIN_DUMP_BYTES = 512;

/** Two-digit zero-pad for a month/day component. */
function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/** A date's UTC calendar day as `YYYY-MM-DD` (UTC so the key never shifts with the runner's zone). */
export function utcDateStamp(date: Date): string {
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** A date's UTC year-month as `YYYY-MM`. */
export function utcMonthStamp(date: Date): string {
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}`;
}

/**
 * Validate the instance name that partitions the R2 keys (e.g. `personal`, `work`). alfred runs as
 * two physically-isolated instances, each its own Supabase database, so every key carries the
 * instance it came from. The name lands inside an object-key path, so it's held to a strict lowercase
 * token — no slashes, dots, or surprises that could reshape the key.
 */
export function assertInstanceName(instance: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(instance)) {
    throw new Error(
      `invalid INSTANCE name "${instance}" — expected a lowercase token like "personal" or "work"`,
    );
  }
}

/**
 * R2 object key for an instance's daily rolling slot; a same-day re-run overwrites rather than
 * duplicates. The instance sits UNDER the `daily/` tier so the one lifecycle rule that expires
 * `daily/` covers every instance at once.
 */
export function dailyKey(instance: string, date: Date): string {
  return `daily/${instance}/${utcDateStamp(date)}.sql.gz`;
}

/**
 * R2 object key for an instance's monthly snapshot slot. Every daily run overwrites it, so it settles
 * to the month's last good backup and freezes once the month rolls over — the retention split is
 * purely by the top-level prefix lifecycle rule (daily/ expires, monthly/ is kept), not by scripted
 * deletion here, and the instance segment leaves that rule instance-agnostic.
 */
export function monthlyKey(instance: string, date: Date): string {
  return `monthly/${instance}/${utcMonthStamp(date)}.sql.gz`;
}

/** Both keys the one verified dump is uploaded to for a given instance's run. */
export function backupKeys(
  instance: string,
  date: Date,
): { readonly daily: string; readonly monthly: string } {
  return { daily: dailyKey(instance, date), monthly: monthlyKey(instance, date) };
}

/** Throw if a dump file is implausibly small (empty or truncated) — never verify or upload it. */
export function assertDumpSize(bytes: number, floor: number = MIN_DUMP_BYTES): void {
  if (bytes < floor) {
    throw new Error(
      `dump is implausibly small (${String(bytes)} bytes < ${String(floor)} floor) — likely empty or truncated; refusing to verify or upload`,
    );
  }
}

/** The core tables absent from a restored set (order follows {@link CORE_TABLES}). */
export function missingCoreTables(present: Iterable<string>): string[] {
  const have = new Set(present);
  return CORE_TABLES.filter((table) => !have.has(table));
}

/** Throw, naming the gaps, if a restored dump is missing any core table. */
export function assertCoreTables(present: Iterable<string>): void {
  const missing = missingCoreTables(present);
  if (missing.length > 0) {
    throw new Error(
      `restored dump is missing core tables: ${missing.join(', ')} — dump is not structurally sound; refusing to upload`,
    );
  }
}

/** One table's column list exactly as a dump's `COPY … FROM stdin;` header declares it. */
export interface CopiedTable {
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * A dumped shape the verify schema has no home for: `columns` are the drifted ones, and `absent`
 * marks the case where the table itself is missing rather than just some of its columns.
 */
export interface TableDrift {
  readonly table: string;
  readonly columns: readonly string[];
  readonly absent: boolean;
}

// The Supabase CLI's pg_dump quotes every identifier (`COPY "public"."items" ("id", …)`) and a
// plain pg_dump quotes none (`COPY public.items (id, …)`), so both forms have to parse.
const COPY_HEADER = /^COPY\s+(?:"?public"?\.)?"?([^\s".]+)"?\s*\(([^)]*)\)\s+FROM\s+stdin;/;

/** Strip one layer of double quotes from a dumped identifier. */
function unquote(identifier: string): string {
  return identifier.trim().replace(/^"(.*)"$/, '$1');
}

/**
 * The tables a dump's data section loads, with the columns each COPY writes. Parsed rather than
 * assumed, because the dump's own headers are the only statement of what production's schema
 * actually held at the moment it was taken.
 *
 * Tracks COPY block boundaries (a lone `\.` ends one) so a data row that happens to begin with
 * `COPY ` — a captured task can be titled anything — is read as data, not as a second header.
 */
export function copiedTables(dumpSql: string): CopiedTable[] {
  const copied: CopiedTable[] = [];
  let inCopyBlock = false;
  for (const line of dumpSql.split('\n')) {
    if (inCopyBlock) {
      if (line === String.raw`\.`) inCopyBlock = false;
      continue;
    }
    const match = COPY_HEADER.exec(line);
    const table = match?.[1];
    const columnList = match?.[2];
    if (table === undefined || columnList === undefined) continue;
    copied.push({ table, columns: columnList.split(',').map((column) => unquote(column)) });
    inCopyBlock = true;
  }
  return copied;
}

/**
 * Where production's shape outruns the schema rebuilt from `database/migrations` — the columns, or
 * whole tables, the dump carries that the verify database has nowhere to put.
 *
 * ONE-DIRECTIONAL by design. The reverse — the repo declaring more than a dump carries — is normal
 * and must never fail a backup: a dump taken between a merge and its migrate job, or against an
 * instance whose migrate job failed (`migrate.yml` runs `fail-fast: false`, so one instance can
 * lag the other), is simply short a column, and COPY leaves the rest at their defaults. Only
 * production-ahead-of-repo can abort a load.
 */
export function schemaDrift(
  dumped: readonly CopiedTable[],
  present: ReadonlyMap<string, readonly string[]>,
): TableDrift[] {
  const drift: TableDrift[] = [];
  for (const { table, columns } of dumped) {
    const have = present.get(table);
    if (have === undefined) {
      drift.push({ table, columns: [...columns], absent: true });
      continue;
    }
    const missing = columns.filter((column) => !have.includes(column));
    if (missing.length > 0) drift.push({ table, columns: missing, absent: false });
  }
  return drift;
}

/** The operator-facing account of the drift: what is ahead, and where to go looking. */
export function describeSchemaDrift(drift: readonly TableDrift[]): string {
  return [
    'production is AHEAD of database/migrations — the dump carries shapes the repo cannot build:',
    ...drift.map(
      ({ table, columns, absent }) =>
        `      ${table}${absent ? ' (whole table)' : ''}: ${columns.join(', ')}`,
    ),
    '    The dump is sound; the VERIFIER is stale. migrate.yml applies on merge, so check, in',
    '    order: is this a re-run replaying an older pinned commit? did a merge land mid-dump',
    '    (db-backup-* and db-migrate-* are separate concurrency groups)? was a migration',
    '    reverted, or DDL applied by hand outside the workflow?',
  ].join('\n');
}

/** Reject an identifier that could break out of its double quoting before it ever reaches SQL. */
function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0 || identifier.includes('"')) {
    throw new Error(`refusing to build SQL for identifier ${JSON.stringify(identifier)}`);
  }
  return `"${identifier}"`;
}

/**
 * DDL giving the throwaway database somewhere to put the drifted data, typed `text` — enough to
 * prove every row LOADS and can be counted, which is what this step exists to check. It is
 * deliberately NOT an attempt to reproduce production's real types: the authoritative schema lives
 * in git and the integration suite is what checks it.
 *
 * This widens what a backup run can survive without softening what it reports — the run still
 * exits non-zero on drift, so the stale migrations still get chased.
 */
export function reconcileDriftStatements(drift: readonly TableDrift[]): string[] {
  return drift.flatMap(({ table, columns, absent }) => {
    const name = `public.${quoteIdentifier(table)}`;
    if (absent) {
      const declarations = columns.map((column) => `${quoteIdentifier(column)} text`).join(', ');
      return [`create table ${name} (${declarations})`];
    }
    return columns.map(
      (column) => `alter table ${name} add column ${quoteIdentifier(column)} text`,
    );
  });
}

/**
 * The run's exit code once the dump has been verified and uploaded. Drift means the artifact is
 * safe but the repo is behind production, and a red run is the only thing that chases that — so a
 * drifted run reports failure even though the backup is in R2. Separated from {@link main} so the
 * "uploaded AND red" pairing is stated once and can't be quietly unpicked.
 */
export function backupExitCode(drift: readonly TableDrift[]): number {
  return drift.length > 0 ? 1 : 0;
}

/**
 * The run's closing line — the one an operator actually reads in the Actions summary. It says only
 * what happened and where the detail is, deliberately NOT a remedy: {@link describeSchemaDrift}
 * above it already walks the causes, and a one-line guess at the fix is what went stale when
 * `migrate.yml` started applying on merge. Paired with {@link backupExitCode} so the wording and
 * the exit code are decided in one place and tested together.
 */
export function backupSummaryLine(drift: readonly TableDrift[]): string {
  return drift.length > 0
    ? '✗ backup uploaded, but production is ahead of database/migrations — see the drift report above'
    : '✓ backup complete';
}

/** Append a progress line to stdout (mirrors the integration runner's plain, greppable logging). */
function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Read a required env var or throw a directive error. Secrets stay in the value, never in a log. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

/**
 * Run a shell step, streaming its output, and throw on a non-zero exit. Commands reference secrets by
 * env-var NAME (e.g. `"$SUPABASE_DB_URL"`) so the value is expanded by bash from the inherited
 * environment and never appears in the command string or in the thrown error.
 */
function run(command: string): void {
  const result = spawnSync('bash', ['-c', command], { stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`backup step failed (exit ${String(result.status ?? 'signal')}): ${command}`);
  }
}

/** The base tables in the restored database's `public` schema. */
async function presentPublicTables(client: InstanceType<typeof Client>): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return rows.map((row) => row.table_name);
}

/** The public schema's base-table columns, keyed by table, as the verify database now holds them. */
async function presentPublicColumns(
  client: InstanceType<typeof Client>,
): Promise<Map<string, string[]>> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
  );
  const columns = new Map<string, string[]>();
  for (const row of rows) {
    const existing = columns.get(row.table_name);
    if (existing === undefined) columns.set(row.table_name, [row.column_name]);
    else existing.push(row.column_name);
  }
  return columns;
}

/**
 * Dump the Supabase database, prove the dump restores, then upload it — in that fixed order, so a
 * dump that won't restore never overwrites the day's slot or counts as a green run.
 *
 *  1. DUMP:   a FULL logical dump. `supabase db dump` writes schema only by default, so we take a
 *             schema dump plus a `--data-only` dump and assemble one restorable artifact: the schema,
 *             then the data loaded with `session_replication_role = replica`. That guard is
 *             load-bearing — `items.parent_id` is a self-referential (circular) FK, so a plain
 *             data-only load fails on row ordering; disabling FK/trigger checks during the COPY (the
 *             source data is already consistent) is how the dump restores standalone anywhere.
 *  2. VERIFY: rebuild the schema in a throwaway Postgres from our OWN committed migrations — which
 *             restore cleanly on vanilla Postgres, unlike the dump's Supabase-managed DDL (it
 *             references the hosted `extensions` schema) — then load the dump's DATA into it with the
 *             same FK guard and assert the core tables are present. The irreplaceable asset is the
 *             data (the schema lives in git), so proving the data reloads into the canonical schema is
 *             the verification that matters, and it sidesteps the vanilla-vs-Supabase schema mismatch.
 *  3. UPLOAD: copy the SAME verified gzip to both the instance's daily and monthly keys.
 *
 * Runs for ONE instance (`INSTANCE`, e.g. `personal` / `work`); the workflow fans out over the
 * instances so each isolated Supabase database is dumped in its own job. Any failed step or
 * assertion exits non-zero → red run → GitHub emails the repo owner.
 */
async function main(): Promise<number> {
  const instance = requireEnv('INSTANCE');
  assertInstanceName(instance);
  requireEnv('SUPABASE_DB_URL');
  const verifyUrl = requireEnv('VERIFY_DB_URL');
  requireEnv('R2_BUCKET');
  requireEnv('R2_ENDPOINT');
  const keys = backupKeys(instance, new Date());

  // Bound outside the try so the final exit code can still see it after the upload.
  let drift: TableDrift[] = [];

  const work = mkdtempSync(path.join(tmpdir(), 'alfred-backup-'));
  const schemaPath = path.join(work, 'schema.sql');
  const dataPath = path.join(work, 'data.sql');
  const gzPath = path.join(work, 'backup.sql.gz');

  try {
    log(`› [${instance}] dumping database (full logical dump: schema + data)…`);
    // Scope to the `public` schema — that's all the app's data (items, folders, projects, …).
    // Without it, --data-only also dumps Supabase's managed `auth`/`storage` schemas, whose COPY
    // statements fail to restore into a cluster that only has our migrations' public schema.
    run(`supabase db dump --db-url "$SUPABASE_DB_URL" --schema public -f ${schemaPath}`);
    run(
      `supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy --schema public -f ${dataPath}`,
    );
    // Assemble the restorable artifact: schema (creates tables + FKs), then data with FK/trigger
    // checks disabled so the circular items.parent_id FK doesn't reject rows during the COPY.
    run(
      String.raw`{ cat ${schemaPath}; printf '\nset session_replication_role = replica;\n'; cat ${dataPath}; printf '\nset session_replication_role = default;\n'; } | gzip -c > ${gzPath}`,
    );
    const size = statSync(gzPath).size;
    assertDumpSize(size);
    log(`  dump ok — ${String(size)} bytes gzipped`);

    log(`› [${instance}] verifying restore into throwaway Postgres…`);
    const client = new Client({ connectionString: verifyUrl });
    await client.connect();
    try {
      // Rebuild the schema from our committed migrations (seeding the Supabase-provided roles +
      // publication they assume), then load the dump's DATA with the same FK guard, in one
      // transaction that aborts on the first error. Using migrations for the schema keeps the
      // throwaway free of the hosted `extensions` schema the dump's own DDL references.
      await bootstrapSupabase(client);
      await applyMigrations(client);
      // …but it also couples the verifier to repo↔production parity, and that can break in ways
      // this job cannot see: a scheduled run pins its commit (a re-run replays it while production
      // moves on), `db-backup-*` and `db-migrate-*` are separate concurrency groups so a merge can
      // apply a migration mid-dump, and a revert or hand-applied DDL puts production ahead
      // outright. In any of those the dump carries a column the repo cannot build and the load
      // aborts on a dump that is perfectly sound — costing the day's backup to a stale verifier.
      // So name that case, give the data somewhere to land, and carry on to the upload; the run
      // still ends red (see the drift exit below) so the mismatch gets chased.
      drift = schemaDrift(
        copiedTables(readFileSync(dataPath, 'utf8')),
        await presentPublicColumns(client),
      );
      if (drift.length > 0) {
        log(`  ⚠ ${describeSchemaDrift(drift)}`);
        for (const statement of reconcileDriftStatements(drift)) {
          await client.query(statement);
        }
      }
      run(
        String.raw`{ printf 'set session_replication_role = replica;\n'; cat ${dataPath}; } | psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 --single-transaction --quiet`,
      );
      assertCoreTables(await presentPublicTables(client));
      for (const table of CORE_TABLES) {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from ${table}`,
        );
        log(`  ${table}: ${String(rows[0]?.n ?? 0)} rows restored`);
      }
    } finally {
      await client.end();
    }
    log('  verify ok — core tables present');

    log(`› [${instance}] uploading verified dump to R2…`);
    for (const key of [keys.daily, keys.monthly]) {
      run(`aws s3 cp ${gzPath} "s3://$R2_BUCKET/${key}" --endpoint-url "$R2_ENDPOINT"`);
      log(`  uploaded ${key}`);
    }
    // The backup exists either way; the exit code is what tells the owner the repo is behind.
    log(backupSummaryLine(drift));
    return backupExitCode(drift);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Only orchestrate when run as a script; importing the module (tests) must not dump anything.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`backup: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
