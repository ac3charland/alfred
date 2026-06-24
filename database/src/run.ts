import process from 'node:process';

import pg from 'pg';

import { runAssertions } from './assertions.ts';
import { startCluster } from './cluster.ts';
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
    const results = await runAssertions(client);

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
