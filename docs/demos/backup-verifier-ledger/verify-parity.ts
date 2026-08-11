/**
 * Replay the nightly backup's VERIFY step against a real, production-shaped database — the step
 * that decided the run's exit code — with the verify schema built two ways:
 *
 *   before — migrations only, as `backup.ts` built it up to 2026-08-11
 *   after  — migrations + the deployer's ledger, as `buildVerifySchema` builds it now
 *
 * Everything here is real: a throwaway PostgreSQL cluster, `deployMigrations` for the production
 * side (so the database carries the ledger exactly as `migrate.yml` leaves it), a genuine
 * `pg_dump --data-only --schema public`, and the nightly's OWN drift functions and summary line
 * reading that dump's `COPY` headers. Only the schema-building step differs between the two runs.
 *
 * Run from the repo root: `node docs/demos/backup-verifier-ledger/verify-parity.ts`
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

import {
  backupExitCode,
  backupSummaryLine,
  copiedTables,
  describeSchemaDrift,
  schemaDrift,
} from '../../../database/src/backup.ts';
import { startCluster } from '../../../database/src/cluster.ts';
import { deployMigrations } from '../../../database/src/deploy.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

/** The `initdb`/`pg_dump` directory, matching what `cluster.ts` resolves the server from. */
function serverBinDir(): string {
  const onPath = spawnSync('bash', ['-c', 'command -v pg_dump'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim().length > 0) return path.dirname(onPath.stdout.trim());
  return '/usr/lib/postgresql/16/bin';
}

/** A connected client on a freshly created, Supabase-bootstrapped database of the cluster. */
async function freshDatabase(
  admin: pg.Client,
  cluster: { host: string; port: number; user: string },
  database: string,
): Promise<pg.Client> {
  await admin.query(`create database ${database}`);
  const client = new pg.Client({ ...cluster, database });
  await client.connect();
  await bootstrapSupabase(client);
  return client;
}

/** The public schema's base-table columns keyed by table — what the verifier can accept a COPY into. */
async function publicColumns(client: pg.Client): Promise<Map<string, string[]>> {
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

const cluster = await startCluster();
const admin = new pg.Client({
  host: cluster.host,
  port: cluster.port,
  user: cluster.user,
  database: cluster.database,
});

try {
  await admin.connect();

  // ── The production side: what `migrate.yml` leaves behind on a live instance.
  const deployed = await freshDatabase(admin, cluster, 'demo_production');
  await deployMigrations(deployed);
  await deployed.end();

  // ── The dump the nightly actually takes, from a real pg_dump.
  const dump = spawnSync(
    `${serverBinDir()}/pg_dump`,
    [
      '--data-only',
      '--schema',
      'public',
      '-h',
      cluster.host,
      '-p',
      String(cluster.port),
      '-U',
      cluster.user,
      'demo_production',
    ],
    { encoding: 'utf8' },
  );
  if (dump.status !== 0) throw new Error(`pg_dump failed: ${dump.stderr}`);
  const copied = copiedTables(dump.stdout);
  process.stdout.write(
    `dump carries COPY headers for: ${copied.map(({ table }) => table).join(', ')}\n\n`,
  );

  // ── The verify side, built each way, judged by the nightly's own functions.
  const variants = [
    {
      label: 'BEFORE — verify schema from database/migrations alone',
      build: async (client: pg.Client) => {
        await applyMigrations(client);
      },
    },
    {
      label: 'AFTER  — verify schema from migrations + the deployer’s ledger',
      build: async (client: pg.Client) => {
        await applyMigrations(client);
        // Inlined rather than calling buildVerifySchema so both runs differ by this line alone.
        const { ensureLedger } = await import('../../../database/src/deploy.ts');
        await ensureLedger(client);
      },
    },
  ];

  for (const [index, { label, build }] of variants.entries()) {
    const verifier = await freshDatabase(admin, cluster, `demo_verify_${String(index)}`);
    try {
      await build(verifier);
      const drift = schemaDrift(copied, await publicColumns(verifier));
      process.stdout.write(`${label}\n`);
      if (drift.length > 0) process.stdout.write(`  ⚠ ${describeSchemaDrift(drift)}\n`);
      process.stdout.write(`  ${backupSummaryLine(drift)}\n`);
      process.stdout.write(`  exit code: ${String(backupExitCode(drift))}\n\n`);
    } finally {
      await verifier.end();
    }
  }
} finally {
  await admin.end();
  cluster.stop();
}
