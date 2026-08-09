import { readFileSync } from 'node:fs';
import process from 'node:process';

import pg from 'pg';

import { attempt, runAssertions } from './assertions.ts';
import { startCluster } from './cluster.ts';
import { runDeployAssertions } from './deploy-assertions.ts';
import {
  TYPES_OUTPUT_PATH,
  assertUsableTypes,
  clusterConnectionString,
  firstDifferingLine,
  generateTypes,
  migrationsChangedSinceTrunk,
} from './gen-types.ts';
import { applyMigrations, bootstrapSupabase } from './migrate.ts';

const { Client } = pg;

/**
 * Stand up a throwaway Postgres, seed the Supabase-provided objects, apply every migration
 * exactly as production does, then run the integration assertions as the real API roles.
 * Returns a process exit code (0 = all passed). The whole cluster is torn down in `finally`.
 */
async function main(): Promise<number> {
  const cluster = await startCluster();
  const client = new Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  try {
    await client.connect();
    await bootstrapSupabase(client);
    // An optional override lets a fixture (or this package's demo) apply a different
    // migration set without touching database/migrations; unset → the real migrations.
    await applyMigrations(client, process.env['ALFRED_MIGRATIONS_DIR']);
    // The typegen assertion reads this same migrated database — `npm run gen-types` is only
    // trustworthy if the type it renders actually describes what the migrations built.
    const typesResult = await attempt(
      'gen-types renders a Database type describing the migrated schema',
      async () => {
        const types = await generateTypes(clusterConnectionString(cluster));
        assertUsableTypes(types);
        // Spot-check one table, one view and one enum, each from a different migration, so a
        // generator that silently returned an empty schema can't pass.
        const missing = ['items: {', 'v_code_stories: {', 'task_priority:'].filter(
          (needle) => !types.includes(needle),
        );
        if (missing.length > 0) {
          throw new Error(`generated types are missing ${missing.join(', ')}`);
        }
        return `${String(types.split('\n').length)} lines covering tables, views and enums`;
      },
    );

    // Freshness gate: a branch that adds a migration must commit the regenerated types with it,
    // or the frontend is typed against a schema that no longer exists. Only that branch pays for
    // the check — with no migration touched the committed file cannot have gone stale, and an
    // ALFRED_MIGRATIONS_DIR override means this cluster isn't the committed set at all. It reuses
    // the type the assertion above already rendered, so the gate costs a string compare.
    const migrationsTouched = migrationsChangedSinceTrunk();
    const overridden = (process.env['ALFRED_MIGRATIONS_DIR'] ?? '') !== '';
    const freshnessResult = await attempt(
      'the committed database types match the migrations',
      async () => {
        if (overridden) return 'skipped — ALFRED_MIGRATIONS_DIR points at another migration set';
        if (migrationsTouched === false) {
          return 'skipped — this branch changes no migration, so the committed types cannot be stale';
        }
        const generated = await generateTypes(clusterConnectionString(cluster));
        const line = firstDifferingLine(readFileSync(TYPES_OUTPUT_PATH, 'utf8'), generated);
        if (line !== -1) {
          throw new Error(
            `frontend/lib/database.types.ts first differs from the migrations at line ${String(line)} — run \`npm run gen-types -w database\` and commit the result`,
          );
        }
        return migrationsTouched === undefined
          ? 'up to date (checked anyway — could not read the diff against trunk)'
          : 'up to date with the migration this branch adds';
      },
    );

    // The schema assertions run against this pre-migrated database; the deploy assertions bring up
    // their own databases on the same cluster (they are about HOW migrations get applied, so they
    // must start from an empty — or deliberately half-migrated — one).
    const results = [
      ...(await runAssertions(client)),
      typesResult,
      freshnessResult,
      ...(await runDeployAssertions(cluster)),
    ];

    let failed = 0;
    for (const result of results) {
      process.stdout.write(
        `${result.ok ? '✓' : '✗'} ${result.name}${result.ok ? ` — ${result.detail}` : ''}\n`,
      );
      if (!result.ok) {
        process.stdout.write(`    ↳ ${result.detail}\n`);
        failed += 1;
      }
    }
    const passed = results.length - failed;
    process.stdout.write(`\ndb-integration: ${String(passed)}/${String(results.length)} passed.\n`);
    return failed > 0 ? 1 : 0;
  } finally {
    await client.end();
    cluster.stop();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(
    `db-integration: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
