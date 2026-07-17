import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';

/** Absolute path to the SQL migrations directory (`database/migrations`). */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

/**
 * The committed, append-only ledger of migrations applied to a live database. `npm run migrate`
 * appends one line here after each successful apply, and the applier reminds you to commit it — so
 * the branch carries a paper trail of what actually reached production. This is the human-facing
 * counterpart to querying the DB: it exists precisely because "0014 was never applied to prod"
 * (ALF-119) and the ALF-124 grant drift were both invisible until they 500'd. Reviewed in git, it
 * makes "which migrations has this database seen?" answerable from the repo.
 */
export const APPLIED_LOG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations-applied.log',
);

/**
 * Format one ledger line: an ISO timestamp, the target host, and the migration filename, tab-
 * separated (so it greps and sorts cleanly). Only the host is recorded from the connection string —
 * never the user or password.
 */
export function formatAppliedLine(when: Date, host: string, migrationFile: string): string {
  return `${when.toISOString()}\t${host}\t${path.basename(migrationFile)}\n`;
}

/** Append a formatted ledger line to the applied-migrations log (creating it if absent). */
export function recordApplied(
  when: Date,
  host: string,
  migrationFile: string,
  logPath: string = APPLIED_LOG_PATH,
): void {
  appendFileSync(logPath, formatAppliedLine(when, host, migrationFile));
}

/**
 * Lexicographic sort returning a copy. `unicorn/no-array-sort` forbids the mutating
 * `.sort()`, and `toSorted()` needs ES2023 while this package targets ES2022 — so use
 * an explicit insertion loop (matching `tools/demo-lint`).
 */
export function sorted(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const insertAt = out.findIndex((existing) => existing > item);
    if (insertAt === -1) out.push(item);
    else out.splice(insertAt, 0, item);
  }
  return out;
}

/**
 * The migration files in apply order. Migrations are named `NNNN_name.sql` and applied
 * in filename order, so a lexicographic sort of the `*.sql` files is the exact prod order.
 */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql'));
  return sorted(names).map((name) => path.join(dir, name));
}

/**
 * Resolve a single migration file from a user selector — the `0011` (or `11`, or a full
 * `0011_task_items_view_columns.sql`) passed to `npm run migrate`. A bare number is zero-padded
 * to the 4-digit `NNNN` prefix, then matched against the `*.sql` basenames. Throws on no match or
 * an ambiguous selector that hits more than one file, so the applier never guesses which to run.
 */
export function resolveMigration(selector: string, dir: string = MIGRATIONS_DIR): string {
  const needle = /^\d+$/.test(selector) ? selector.padStart(4, '0') : selector;
  const matches = migrationFiles(dir).filter((file) => {
    const base = path.basename(file);
    return base === needle || base === `${needle}.sql` || base.startsWith(`${needle}_`);
  });
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  const available = migrationFiles(dir)
    .map((file) => path.basename(file))
    .join(', ');
  if (matches.length === 0) {
    throw new Error(`no migration matches "${selector}". Available: ${available}`);
  }
  throw new Error(
    `selector "${selector}" is ambiguous (${String(matches.length)} matches). Available: ${available}`,
  );
}

/**
 * Pull a single value out of a dotenv-style file body (e.g. `frontend/.env.local`). Skips blank and
 * `#`-comment lines, tolerates a leading `export `, and strips one layer of matching surrounding
 * quotes. Returns `undefined` when the key isn't present — kept tiny so the package needs no dotenv dep.
 */
export function parseEnvValue(content: string, key: string): string | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim();
    return value.replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/** Where the gitignored `DATABASE_URL` lives — `frontend/.env.local`, relative to this package. */
export const ENV_LOCAL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../frontend/.env.local',
);

/**
 * Create the objects Supabase provides out of the box that the migrations assume exist:
 * the three API roles and the `supabase_realtime` publication (0003 adds a table to it).
 * On a hosted Supabase project these already exist; a vanilla cluster needs them seeded.
 */
export async function bootstrapSupabase(client: Client): Promise<void> {
  await client.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
}

/**
 * Apply every migration in order, exactly as production does (raw SQL, filename order) —
 * so missing grants, RLS gaps, and constraint timing surface here, not in production.
 * Each file is sent as one simple-query batch (multi-statement, dollar-quoted bodies OK).
 */
export async function applyMigrations(client: Client, dir: string = MIGRATIONS_DIR): Promise<void> {
  for (const file of migrationFiles(dir)) {
    await client.query(readFileSync(file, 'utf8'));
  }
}
