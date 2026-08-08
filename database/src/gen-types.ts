import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Deep imports: the package ships no `exports` map, and only `PostgresMeta` is re-exported from its
// main entry — the metadata reader and the TypeScript template live at these paths. This is the same
// generator code the Supabase CLI runs inside its `supabase/postgres-meta` container, so the output
// matches what the hosted flow produced; the version is pinned exactly for that reason.
import { getGeneratorMetadata } from '@supabase/postgres-meta/dist/lib/generators.js';
import { PostgresMeta } from '@supabase/postgres-meta/dist/lib/index.js';
import { apply as applyTypescriptTemplate } from '@supabase/postgres-meta/dist/server/templates/typescript.js';
import pg from 'pg';

import { startCluster } from './cluster.ts';
import { applyMigrations, bootstrapSupabase } from './migrate.ts';

/**
 * Where the generated `Database` type lands — the file every frontend query is typed against.
 * It is a generated artifact: excluded from ESLint and Prettier, and never hand-edited.
 */
export const TYPES_OUTPUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../frontend/lib/database.types.ts',
);

/**
 * The schemas to describe. `public` is the whole app surface and the only schema the migrations
 * build; Supabase's managed schemas (`auth`, `storage`, `graphql_public`) exist on the hosted
 * projects only, so a throwaway cluster cannot — and should not — speak for them.
 */
export const GENERATED_SCHEMAS = ['public'] as const;

/**
 * Stamped into `__InternalSupabase.PostgrestVersion`, which supabase-js reads to pick its client
 * behaviour. It describes the hosted platform's PostgREST, so it is the one value local generation
 * cannot observe — carried as a constant to keep the generated file stable, and bumped by hand when
 * Supabase upgrades PostgREST.
 */
export const POSTGREST_VERSION = '14.5';

/** The parts of a running cluster a libpq URL needs. {@link startCluster}'s result satisfies it. */
export interface ConnectionParts {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
}

/** A passwordless libpq URL for a throwaway cluster (it is initialized with `--auth=trust`). */
export function clusterConnectionString({ host, port, user, database }: ConnectionParts): string {
  return `postgresql://${user}@${host}:${String(port)}/${database}`;
}

/**
 * Refuse output that would damage the committed file if written. A generator that failed to read the
 * database still returns a syntactically fine skeleton, so the guard is structural — the `Database`
 * declaration and a `public` schema inside it — rather than a byte count.
 */
export function assertUsableTypes(text: string): void {
  if (text.trim() === '') {
    throw new Error(
      'the generator produced empty output — refusing to overwrite the committed types',
    );
  }
  if (!text.includes('export type Database')) {
    throw new Error('the generated output declares no `Database` type — refusing to write it');
  }
  if (!/^\s{2}public: \{/m.test(text)) {
    throw new Error(
      'the generated output has no `public` schema — the migrations did not apply to the throwaway cluster',
    );
  }
}

/** Trunk refs to diff against, in priority order (first existing one wins). */
const TRUNK_REFS: readonly string[] = ['origin/main', 'main', 'origin/master', 'master'];

/** Whether any changed path is a migration — the only kind of change that can restate the types. */
export function touchesMigrations(changedPaths: readonly string[]): boolean {
  return changedPaths.some((changed) => /(?:^|\/)database\/migrations\/[^/]+\.sql$/.test(changed));
}

/**
 * Whether this branch adds or edits a migration relative to trunk, which is the only way the
 * committed types can have gone stale. `undefined` when git can't tell us — no trunk ref among
 * {@link TRUNK_REFS} (a shallow CI checkout), or any command failing — which callers must read as
 * "check anyway": a freshness gate must never go quiet on a guess. Diffed against the **working
 * tree**, so an uncommitted migration counts too.
 */
export function migrationsChangedSinceTrunk(): boolean | undefined {
  const trunk = TRUNK_REFS.find(
    (ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref]).status === 0,
  );
  if (trunk === undefined) return undefined;
  const base = spawnSync('git', ['merge-base', 'HEAD', trunk], { encoding: 'utf8' });
  if (base.status !== 0) return undefined;
  const mergeBase = base.stdout.trim();
  if (mergeBase === '') return undefined;
  // `:/` anchors the pathspec at the repo root, so this works from any package's cwd.
  const diff = spawnSync('git', ['diff', '--name-only', mergeBase, '--', ':/database/migrations'], {
    encoding: 'utf8',
  });
  if (diff.status !== 0) return undefined;
  // A NEW migration is the common case and starts out untracked, which `git diff` does not list —
  // relying on the diff alone would silently skip the gate exactly when it matters most.
  // `--full-name` is required: unlike `git diff --name-only`, `ls-files` prints paths relative to
  // the CURRENT directory, so without it the two lists disagree whenever this runs from a package.
  const untracked = spawnSync(
    'git',
    ['ls-files', '--full-name', '--others', '--exclude-standard', '--', ':/database/migrations'],
    { encoding: 'utf8' },
  );
  if (untracked.status !== 0) return undefined;
  return touchesMigrations(
    `${diff.stdout}\n${untracked.stdout}`.split(/\r?\n/).map((line) => line.trim()),
  );
}

/** The 1-based line where two texts first diverge, or `-1` when they are identical. */
export function firstDifferingLine(a: string, b: string): number {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return i + 1;
  }
  return -1;
}

/**
 * Describe a live database as a TypeScript `Database` type. Reads the schema through postgres-meta
 * and renders it with the same template the Supabase CLI uses, so the result is byte-comparable with
 * a file generated the hosted way (modulo the managed schemas a local cluster doesn't carry).
 */
export async function generateTypes(connectionString: string): Promise<string> {
  const pgMeta = new PostgresMeta({ connectionString, max: 1 });
  try {
    const { data, error } = await getGeneratorMetadata(pgMeta, {
      includedSchemas: [...GENERATED_SCHEMAS],
    });
    if (error) throw new Error(`could not read the schema: ${error.message}`);
    return await applyTypescriptTemplate({
      ...data,
      detectOneToOneRelationships: true,
      postgrestVersion: POSTGREST_VERSION,
    });
  } finally {
    await pgMeta.end();
  }
}

/**
 * Build the types the committed migrations imply, without touching any live database: stand up the
 * throwaway cluster the integration suite uses, apply every migration in production's order, and
 * describe the result. That's what makes this safe to run before a migration merges — the schema it
 * reads is the one the branch builds, not the one production happens to be at.
 */
export async function typesFromMigrations(): Promise<string> {
  const cluster = await startCluster();
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client);
    await client.end();
    const types = await generateTypes(clusterConnectionString(cluster));
    assertUsableTypes(types);
    return types;
  } finally {
    cluster.stop();
  }
}

/** Append a progress line to stdout (mirrors the deploy script's plain, greppable logging). */
function stdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Regenerate `frontend/lib/database.types.ts` from the committed migrations, or with `--check`
 * report whether the committed file already matches (exit 1 if it doesn't, writing nothing).
 */
async function main(): Promise<number> {
  const checkOnly = process.argv.slice(2).includes('--check');
  stdout('→ applying every migration to a throwaway cluster…');
  const generated = await typesFromMigrations();
  const relative = path.relative(process.cwd(), TYPES_OUTPUT_PATH);

  if (checkOnly) {
    const committed = readFileSync(TYPES_OUTPUT_PATH, 'utf8');
    const line = firstDifferingLine(committed, generated);
    if (line === -1) {
      stdout(`✓ ${relative} matches the migrations`);
      return 0;
    }
    process.stderr.write(
      `✗ ${relative} is stale — it first differs from the migrations at line ${String(line)}. Run \`npm run gen-types -w database\` and commit the result.\n`,
    );
    return 1;
  }

  writeFileSync(TYPES_OUTPUT_PATH, generated);
  stdout(`✓ wrote ${relative} (${String(generated.split('\n').length)} lines)`);
  return 0;
}

// Only run the CLI when this file IS the entry point; importing it (the unit test) must not
// stand up a cluster or write anything.
if (import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`gen-types: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
