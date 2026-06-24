import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
