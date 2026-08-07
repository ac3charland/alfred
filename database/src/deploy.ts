import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import pg, { type Client } from 'pg';

import { MIGRATIONS_DIR, migrationFiles, resolveDatabaseUrl } from './migrate.ts';

/**
 * The per-database ledger of applied migrations — the source of truth for "what has THIS database
 * seen?". The committed `migrations-applied.log` records the shared history a human typed, but it
 * cannot answer that question per instance (Personal and Work are separate Supabase databases),
 * which is exactly what an unattended deploy must know before it runs a file.
 *
 * It lives in `public` so it travels with the schema-scoped nightly dump (`supabase db dump
 * --schema public`) — a database restored from a backup therefore still knows its own history. It
 * is deliberately created WITHOUT grants, so the PostgREST API roles (`anon`, `authenticated`)
 * cannot read or write it; only the direct connection the deployer opens touches it.
 */
export const LEDGER_TABLE = 'public.schema_migrations';

/**
 * The last migration applied to the live databases BY HAND, before this deployer existed. A
 * database that already carries the app schema but has no ledger predates the automation, so its
 * first deploy records every migration up to and including this file as already applied instead of
 * re-running it (re-running `0001` would fail on `type "item_type" already exists`).
 *
 * This is a historical fact about the Personal and Work databases, NOT a pointer at "the newest
 * migration" — never advance it. Once every database has a ledger it is dead weight that only
 * matters again when a new instance is provisioned from an out-of-band schema copy.
 */
export const BASELINE_MIGRATION = '0026_inbox_dispatch.sql';

/**
 * Advisory-lock key held for the length of a deploy, so two runs — a merge racing a manual
 * `npm run migrate`, or a re-queued workflow — can never apply the same file twice. An arbitrary
 * fixed number is enough: alfred takes no other advisory locks.
 */
export const MIGRATION_LOCK_KEY = 177;

/** What a deploy will do: files recorded as already-applied, and files to actually run. */
export interface MigrationPlan {
  /** Recorded in the ledger WITHOUT being run — history the database already carries. */
  readonly baseline: readonly string[];
  /** Run in this (filename) order, each in its own transaction with its ledger row. */
  readonly apply: readonly string[];
}

/** Inputs {@link planMigrations} decides from — all facts read off the target database. */
export interface PlanInput {
  /** Every migration basename, in apply order. */
  readonly files: readonly string[];
  /** Basenames the ledger already records (any order). */
  readonly applied: Iterable<string>;
  /** Whether the database already carries the app schema (i.e. it is not empty). */
  readonly hasAppSchema: boolean;
  /** Override the {@link BASELINE_MIGRATION} cut-off; tests pin their own. */
  readonly baseline?: string;
}

/**
 * Decide what a deploy should do against one database. Three cases, in the order they are checked:
 *
 * - **Ledger has rows** — the normal path: apply every file the ledger doesn't record, in file order.
 * - **No ledger rows, but the app schema exists** — a database that predates this deployer: record
 *   the history through {@link BASELINE_MIGRATION} as already applied, then apply what came after.
 * - **No ledger rows and no schema** — a brand-new database: apply everything from `0001`.
 */
export function planMigrations({
  files,
  applied,
  hasAppSchema,
  baseline = BASELINE_MIGRATION,
}: PlanInput): MigrationPlan {
  const done = new Set(applied);
  if (done.size === 0 && hasAppSchema) {
    const cut = files.indexOf(baseline);
    if (cut === -1) {
      throw new Error(
        `baseline migration "${baseline}" is not in the migration set — it was renamed or removed; a pre-ledger database cannot be baselined until that is resolved`,
      );
    }
    return { baseline: files.slice(0, cut + 1), apply: files.slice(cut + 1) };
  }
  return { baseline: [], apply: files.filter((file) => !done.has(file)) };
}

/**
 * Ledger rows with no matching migration file — a migration was renamed or deleted after it was
 * applied. Renaming is the dangerous half: the new name is unrecorded, so the deploy would run its
 * (already-applied) SQL again. Surfaced as a warning rather than a failure, since deletions are
 * legitimate and migrations are otherwise append-only.
 */
export function unknownApplied(
  files: readonly string[],
  applied: Iterable<string>,
): readonly string[] {
  const known = new Set(files);
  return [...applied].filter((name) => !known.has(name));
}

/** Whether the ledger table exists yet (absent on any database this deployer hasn't run against). */
export async function ledgerExists(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [LEDGER_TABLE],
  );
  return rows[0]?.present ?? false;
}

/**
 * Whether the database already carries the app schema. `items` is the core table `0001` creates, so
 * its presence is what separates "a live database that predates the ledger" from "an empty one".
 */
export async function hasAppSchema(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    "select to_regclass('public.items') is not null as present",
  );
  return rows[0]?.present ?? false;
}

/** Create the ledger table if it isn't there yet. Idempotent, and never granted to the API roles. */
export async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    create table if not exists ${LEDGER_TABLE} (
      filename   text primary key,
      applied_at timestamptz not null default now()
    );
    comment on table ${LEDGER_TABLE} is
      'Applied-migration ledger for THIS database, written by database/src/deploy.ts. applied_at is when the row was written — for baselined rows that is when the deployer first recognized the pre-existing history, not when the SQL originally ran. No grants: the API roles must never see it.';
  `);
}

/** The migration basenames this database's ledger records; `[]` when the ledger doesn't exist yet. */
export async function appliedMigrations(client: Client): Promise<string[]> {
  if (!(await ledgerExists(client))) return [];
  const { rows } = await client.query<{ filename: string }>(`select filename from ${LEDGER_TABLE}`);
  return rows.map((row) => row.filename);
}

/** Record migrations as applied. `on conflict do nothing` keeps every caller idempotent. */
export async function recordInLedger(client: Client, names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  await client.query(
    `insert into ${LEDGER_TABLE} (filename) select unnest($1::text[]) on conflict (filename) do nothing`,
    [names],
  );
}

/**
 * Make the ledger reflect the history a database already carries, and return what was baselined.
 * Returns `[]` for a database that already has ledger rows, and for an empty one (nothing to
 * assume). Both entry points must call this **before** they record anything of their own: the
 * ledger is read as "the whole story", so a first row written without the baseline behind it would
 * strand the deployer — it would see one recorded migration on a full database and try to replay
 * `0001` on the next merge.
 */
async function bootstrapLedger(client: Client, dir: string): Promise<readonly string[]> {
  await ensureLedger(client);
  const { baseline } = planMigrations({
    files: migrationFiles(dir).map((file) => path.basename(file)),
    applied: await appliedMigrations(client),
    hasAppSchema: await hasAppSchema(client),
  });
  await recordInLedger(client, baseline);
  return baseline;
}

/**
 * Record a migration applied BY HAND (`npm run migrate`) in the target database's ledger, so the
 * merge pipeline sees it as done rather than applying it a second time. Baselines the history
 * behind it first — see {@link bootstrapLedger}.
 */
export async function recordManualApply(
  client: Client,
  file: string,
  dir: string = MIGRATIONS_DIR,
): Promise<void> {
  await bootstrapLedger(client, dir);
  await recordInLedger(client, [path.basename(file)]);
}

/**
 * Run ONE migration file and record it, in a single transaction: a file that fails leaves neither
 * half-applied SQL nor a ledger row claiming it succeeded. The file is sent as one simple-query
 * batch (multi-statement, dollar-quoted bodies OK), exactly as production applies it — no migration
 * opens its own transaction or uses `CONCURRENTLY`, both of which would break this wrapper.
 */
export async function applyMigration(client: Client, file: string): Promise<void> {
  await client.query('begin');
  try {
    await client.query(readFileSync(file, 'utf8'));
    await client.query(`insert into ${LEDGER_TABLE} (filename) values ($1)`, [path.basename(file)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Knobs for {@link deployMigrations}; every one has a sane default for the CI path. */
export interface DeployOptions {
  /** `| undefined` so a caller can forward an unset env override straight through. */
  readonly dir?: string | undefined;
  /** Report the plan without writing anything — not even the ledger table. */
  readonly dryRun?: boolean;
  /** Progress sink. Omitted (the integration suite) means the deploy runs silently. */
  readonly log?: (message: string) => void;
}

/**
 * Bring one database up to date with `database/migrations/`, and return what was done. Takes an
 * advisory lock before reading the ledger so a concurrent deploy can't plan against state this one
 * is about to change, then applies each pending file in filename order — the same order, and the
 * same raw SQL, that `npm run migrate` and the integration suite use.
 */
export async function deployMigrations(
  client: Client,
  { dir = MIGRATIONS_DIR, dryRun = false, log }: DeployOptions = {},
): Promise<MigrationPlan> {
  if (!dryRun) {
    await ensureLedger(client);
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  }
  try {
    const names = migrationFiles(dir).map((file) => path.basename(file));
    const applied = await appliedMigrations(client);
    const plan = planMigrations({
      files: names,
      applied,
      hasAppSchema: await hasAppSchema(client),
    });

    for (const orphan of unknownApplied(names, applied)) {
      log?.(
        `! ledger records ${orphan}, which is no longer in the migration set (renamed? deleted?)`,
      );
    }
    if (plan.baseline.length > 0) {
      log?.(
        `› no ledger yet on an existing database — recording ${String(plan.baseline.length)} migrations through ${BASELINE_MIGRATION} as already applied`,
      );
    }
    if (dryRun) {
      log?.(`(dry run — nothing written; ${String(plan.apply.length)} migration(s) pending)`);
      for (const name of plan.apply) log?.(`  would apply ${name}`);
      return plan;
    }

    await recordInLedger(client, plan.baseline);
    for (const name of plan.apply) {
      log?.(`→ applying ${name}…`);
      await applyMigration(client, path.join(dir, name));
      log?.(`✓ applied ${name}`);
    }
    if (plan.apply.length === 0) log?.('✓ already up to date — nothing to apply');
    return plan;
  } finally {
    if (!dryRun) await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

/** Append a progress line to stdout (mirrors the backup script's plain, greppable logging). */
function stdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Apply every pending migration to the database named by `SUPABASE_DB_URL` — the merge pipeline's
 * entry point, and a usable local command (`--dry-run` to see what's pending on a live database).
 * `INSTANCE` only labels the output, so a matrix run's two jobs stay readable.
 */
async function main(): Promise<number> {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const instance = process.env['INSTANCE'];
  const label = instance === undefined || instance === '' ? '' : `[${instance}] `;
  const url = resolveDatabaseUrl(['SUPABASE_DB_URL', 'DATABASE_URL']);
  // Only the host — never the user or password — is ever printed.
  stdout(`${label}→ target: ${new URL(url).host}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const plan = await deployMigrations(client, {
      // The same override the integration runner honors: point a run at a different migration set
      // (a fixture, this package's demo) without touching database/migrations. Unset → the real one.
      dir: process.env['ALFRED_MIGRATIONS_DIR'],
      dryRun,
      log: (message) => {
        stdout(`${label}${message}`);
      },
    });
    stdout(
      `${label}${dryRun ? 'pending' : 'applied'}: ${String(plan.apply.length)} migration(s)${plan.baseline.length > 0 ? `, baselined: ${String(plan.baseline.length)}` : ''}`,
    );
    return 0;
  } finally {
    await client.end();
  }
}

// Only deploy when run as a script; importing the module (tests) must not touch a database.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`deploy: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
