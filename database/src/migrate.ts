import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';

/** Absolute path to the SQL migrations directory (`database/migrations`). */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

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
 * Pull a single value out of a dotenv-style file body (e.g. `frontend/.env.local`). Skips blank and
 * `#`-comment lines, tolerates a leading `export `, and strips one layer of matching surrounding
 * quotes. The LAST assignment of a duplicated key wins, as in dotenv and Next.js, so this reads the
 * same URL the app does. Returns `undefined` when the key isn't present — kept tiny so the package
 * needs no dotenv dep.
 */
export function parseEnvValue(content: string, key: string): string | undefined {
  let found: string | undefined;
  for (const raw of content.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim();
    found = value.replace(/^(['"])(.*)\1$/, '$2');
  }
  return found;
}

/** The repo root this module lives in (`database/src` -> two levels up). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the gitignored `DATABASE_URL` lives inside a checkout: `frontend/.env.local`. */
const ENV_LOCAL_RELATIVE = path.join('frontend', '.env.local');

/** Where the gitignored `DATABASE_URL` lives — `frontend/.env.local`, relative to this package. */
/**
 * The main checkout's root when `repoRoot` is a linked git worktree: the directory holding git's
 * common dir. `undefined` in a plain checkout, or when git is unavailable or can't tell.
 */
function mainCheckoutRoot(repoRoot: string): string | undefined {
  // Git hooks export these, and they'd point the child at the hook's repo instead of `repoRoot`.
  const { GIT_DIR: _dir, GIT_INDEX_FILE: _index, GIT_WORK_TREE: _tree, ...env } = process.env;
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repoRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return commonDir === '' ? undefined : path.dirname(commonDir);
  } catch {
    return undefined;
  }
}

/**
 * The `frontend/.env.local` files to consult, in order: this checkout's own, then — in a linked
 * worktree, where the gitignored file exists only in the main checkout — the main checkout's.
 */
export function envLocalCandidates(repoRoot: string = REPO_ROOT): string[] {
  const own = path.join(repoRoot, ENV_LOCAL_RELATIVE);
  const main = mainCheckoutRoot(repoRoot);
  if (main === undefined) return [own];
  const fallback = path.join(main, ENV_LOCAL_RELATIVE);
  return path.resolve(fallback) === path.resolve(own) ? [own] : [own, fallback];
}

/**
 * Resolve a live connection string: the first of `names` that is exported, else `DATABASE_URL` out
 * of the first of `envLocalPaths` that has one (default: this checkout's gitignored
 * `frontend/.env.local`, then the main checkout's when running in a linked worktree). Throws a
 * directive error naming every path tried (never a value) when nothing is available.
 * `database/src/deploy.ts` looks at `SUPABASE_DB_URL` first, the name the workflow secrets use.
 */
export function resolveDatabaseUrl(
  names: readonly string[] = ['DATABASE_URL'],
  envLocalPaths: readonly string[] = envLocalCandidates(),
): string {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  for (const envPath of envLocalPaths) {
    if (!existsSync(envPath)) continue;
    const fromFile = parseEnvValue(readFileSync(envPath, 'utf8'), 'DATABASE_URL');
    if (fromFile !== undefined && fromFile !== '') return fromFile;
  }
  throw new Error(
    `none of ${names.join(', ')} is set and no DATABASE_URL found in ${envLocalPaths.join(' or ')}`,
  );
}

/**
 * Create the objects Supabase provides out of the box that the migrations assume exist:
 * the three API roles and the `supabase_realtime` publication (0003 adds a table to it).
 * On a hosted Supabase project these already exist; a vanilla cluster needs them seeded.
 *
 * Idempotent, because roles are CLUSTER-global while publications are per-database: a second
 * database on the same cluster needs its own publication but must not re-create the roles.
 */
export async function bootstrapSupabase(client: Client): Promise<void> {
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
      if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
      end if;
    end $$;
  `);
}

/**
 * Apply migrations in order, exactly as production does (raw SQL, filename order) — so missing
 * grants, RLS gaps, and constraint timing surface here, not in production. Each file is sent as
 * one simple-query batch (multi-statement, dollar-quoted bodies OK).
 *
 * `include` narrows the set, so a caller can stop the history at a chosen point, seed the world as
 * it stood then, and apply the next migration over that data — the only way to judge a BACKFILL,
 * which by definition only touches rows that already existed. Defaults to every migration.
 */
export async function applyMigrations(
  client: Client,
  dir: string = MIGRATIONS_DIR,
  include: (file: string) => boolean = () => true,
): Promise<void> {
  for (const file of migrationFiles(dir).filter((file) => include(file))) {
    await client.query(readFileSync(file, 'utf8'));
  }
}
