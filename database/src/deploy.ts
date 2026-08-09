import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import pg, { type Client } from 'pg';

import { MIGRATIONS_DIR, migrationFiles, resolveDatabaseUrl } from './migrate.ts';

/**
 * The per-database ledger of applied migrations — the source of truth for "what has THIS database
 * seen?" (Personal and Work are separate Supabase databases, so no single shared record could
 * answer that per instance) — exactly what an unattended deploy must know before it runs a file.
 *
 * It lives in `public` so it travels with the schema-scoped nightly dump (`supabase db dump
 * --schema public`) — a database restored from a backup therefore still knows its own history. It
 * is deliberately created WITHOUT grants, so the PostgREST API roles (`anon`, `authenticated`)
 * cannot read or write it; only the direct connection the deployer opens touches it.
 */
export const LEDGER_TABLE = 'public.schema_migrations';

/**
 * Advisory-lock key held for the length of a deploy, so two runs — a merge racing a re-queued
 * workflow — can never apply the same file twice. An arbitrary fixed number is enough: alfred
 * takes no other advisory locks.
 */
export const MIGRATION_LOCK_KEY = 177;

/** What a deploy will do: files recorded as already-applied, and files to actually run. */
export interface MigrationPlan {
  /** Recorded in the ledger WITHOUT being run — history the database is declared to carry. */
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
  /** Adoption point for a pre-ledger database — supplied deliberately, never defaulted. */
  readonly baseline?: string | undefined;
}

/**
 * Decide what a deploy should do against one database. Three cases, in the order they are checked:
 *
 * - **Ledger has rows** — the normal path: apply every file the ledger doesn't record, in file order.
 * - **No ledger rows and no schema** — a brand-new database: apply everything from `0001`.
 * - **No ledger rows, but the app schema exists** — an *unadopted* database. Its history is
 *   unknowable from here, so this **throws** unless the caller supplies `baseline`, the migration
 *   the operator has verified it stands at; everything through that file is then recorded as
 *   applied and the rest is run.
 *
 * That last case is deliberately not a guess. Both live databases turned out to sit somewhere
 * other than the point they were assumed to (Work was nine migrations behind; Personal had lost a
 * function rewrite), and recording an assumed history would have marked those real gaps as applied
 * and hidden them permanently. A loud failure is recoverable; a false ledger row is not.
 */
export function planMigrations({
  files,
  applied,
  hasAppSchema,
  baseline,
}: PlanInput): MigrationPlan {
  const done = new Set(applied);
  if (done.size === 0 && hasAppSchema) {
    if (baseline === undefined) {
      throw new Error(
        'this database has the app schema but no migration ledger, so what it has applied is unknown — refusing to guess. Verify its state, then adopt it once with --baseline <migration it stands at>; see database/README.md.',
      );
    }
    const cut = files.indexOf(baseline);
    if (cut === -1) {
      throw new Error(
        `baseline migration "${baseline}" is not in the migration set — check the filename against database/migrations/`,
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
      'Applied-migration ledger for THIS database, written by database/src/deploy.ts. applied_at is when the row was written — for rows recorded by a one-time --baseline adoption that is when the database was adopted, not when the SQL originally ran. No grants: the API roles must never see it.';
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
  /**
   * One-time adoption of a database that has schema but no ledger: the migration an operator has
   * VERIFIED it stands at. Never set by the pipeline — a merge must not adopt anything.
   */
  readonly baseline?: string | undefined;
  /** Progress sink. Omitted (the integration suite) means the deploy runs silently. */
  readonly log?: (message: string) => void;
}

/**
 * Bring one database up to date with `database/migrations/`, and return what was done. Takes an
 * advisory lock before reading the ledger so a concurrent deploy can't plan against state this one
 * is about to change, then applies each pending file in filename order — the same order, and the
 * same raw SQL, that the integration suite uses.
 */
export async function deployMigrations(
  client: Client,
  { dir = MIGRATIONS_DIR, dryRun = false, baseline, log }: DeployOptions = {},
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
      baseline,
    });

    for (const orphan of unknownApplied(names, applied)) {
      log?.(
        `! ledger records ${orphan}, which is no longer in the migration set (renamed? deleted?)`,
      );
    }
    if (plan.baseline.length > 0) {
      log?.(
        `› adopting this database at ${String(baseline)} — recording ${String(plan.baseline.length)} migrations as already applied, on your word`,
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
 * entry point, and a usable local command (`--dry-run` to see what's pending on a live database,
 * `--baseline <file>` to adopt an unadopted one). `INSTANCE` only labels the output, so a matrix
 * run's two jobs stay readable.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  // `--baseline <file>`: a one-time, operator-verified adoption. The workflow never passes it.
  const baselineAt = args.indexOf('--baseline');
  const baseline = baselineAt === -1 ? undefined : args[baselineAt + 1];
  if (baselineAt !== -1 && (baseline === undefined || baseline.startsWith('-'))) {
    process.stderr.write('deploy: --baseline needs a migration filename\n');
    return 1;
  }
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
      baseline,
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
