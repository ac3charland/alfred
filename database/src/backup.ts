import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

import { bootstrapSupabase } from './migrate.ts';

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

/** R2 object key for the day's rolling slot; a same-day re-run overwrites rather than duplicates. */
export function dailyKey(date: Date): string {
  return `daily/${utcDateStamp(date)}.sql.gz`;
}

/**
 * R2 object key for the month's snapshot slot. Every daily run overwrites it, so it settles to the
 * month's last good backup and freezes once the month rolls over — the retention split is purely by
 * prefix lifecycle rule (daily/ expires, monthly/ is kept), not by scripted deletion here.
 */
export function monthlyKey(date: Date): string {
  return `monthly/${utcMonthStamp(date)}.sql.gz`;
}

/** Both keys the one verified dump is uploaded to for a given run. */
export function backupKeys(date: Date): { readonly daily: string; readonly monthly: string } {
  return { daily: dailyKey(date), monthly: monthlyKey(date) };
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

/**
 * Dump the Supabase database, prove the dump restores, then upload it — in that fixed order, so a
 * dump that won't restore never overwrites the day's slot or counts as a green run.
 *
 *  1. DUMP:   a FULL logical dump. `supabase db dump` writes schema only by default, so we take a
 *             schema dump followed by a `--data-only` dump and concatenate them; the result restores
 *             standalone (DDL creates the tables, then COPY loads the rows) with no migration replay.
 *             Assert the gzip clears the size floor before trusting it.
 *  2. VERIFY: restore into a throwaway Postgres (the Actions service container) — seeding the
 *             Supabase-provided roles/publication first, exactly as the integration suite does, so the
 *             dump's GRANTs and policies apply — then assert the core tables are present.
 *  3. UPLOAD: copy the SAME verified gzip to both the daily and monthly keys.
 *
 * Any failed step or assertion exits non-zero → red run → GitHub emails the repo owner.
 */
async function main(): Promise<number> {
  const keys = backupKeys(new Date());
  requireEnv('SUPABASE_DB_URL');
  const verifyUrl = requireEnv('VERIFY_DB_URL');
  requireEnv('R2_BUCKET');
  requireEnv('R2_ENDPOINT');

  const work = mkdtempSync(path.join(tmpdir(), 'alfred-backup-'));
  const schemaPath = path.join(work, 'schema.sql');
  const dataPath = path.join(work, 'data.sql');
  const gzPath = path.join(work, 'backup.sql.gz');

  try {
    log('› dumping database (full logical dump: schema + data)…');
    run(`supabase db dump --db-url "$SUPABASE_DB_URL" -f ${schemaPath}`);
    run(`supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy -f ${dataPath}`);
    run(`cat ${schemaPath} ${dataPath} | gzip -c > ${gzPath}`);
    const size = statSync(gzPath).size;
    assertDumpSize(size);
    log(`  dump ok — ${String(size)} bytes gzipped`);

    log('› verifying restore into throwaway Postgres…');
    const client = new Client({ connectionString: verifyUrl });
    await client.connect();
    try {
      // Seed the objects a hosted Supabase provides but a vanilla cluster lacks (the API roles +
      // realtime publication) so the dump's grants/policies restore, then load the dump with psql
      // (it handles the COPY blocks) under a single transaction that aborts on the first error.
      await bootstrapSupabase(client);
      run(
        `gunzip -c ${gzPath} | psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 --single-transaction --quiet`,
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

    log('› uploading verified dump to R2…');
    for (const key of [keys.daily, keys.monthly]) {
      run(`aws s3 cp ${gzPath} "s3://$R2_BUCKET/${key}" --endpoint-url "$R2_ENDPOINT"`);
      log(`  uploaded ${key}`);
    }
    log('✓ backup complete');
    return 0;
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
