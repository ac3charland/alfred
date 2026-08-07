import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg, { type Client } from 'pg';

import { type AssertionResult, attempt } from './assertions.ts';
import type { Cluster } from './cluster.ts';
import {
  BASELINE_MIGRATION,
  LEDGER_TABLE,
  appliedMigrations,
  applyMigration,
  deployMigrations,
  recordManualApply,
} from './deploy.ts';
import {
  MIGRATIONS_DIR,
  applyMigrations,
  bootstrapSupabase,
  migrationFiles,
  sorted,
} from './migrate.ts';

/** Every migration basename in apply order — what a fully-deployed database's ledger must hold. */
function allMigrationNames(): string[] {
  return migrationFiles(MIGRATIONS_DIR).map((file) => path.basename(file));
}

/** The migrations up to and including {@link BASELINE_MIGRATION} — the hand-applied history. */
function throughBaseline(names: readonly string[]): string[] {
  return names.slice(0, names.indexOf(BASELINE_MIGRATION) + 1);
}

/** The migrations that landed after the baseline — what a pre-ledger database still needs. */
function afterBaseline(names: readonly string[]): string[] {
  return names.slice(names.indexOf(BASELINE_MIGRATION) + 1);
}

/**
 * Create a database on the cluster and hand a connected client to `fn`, closing it afterwards. The
 * name is a code literal, never user input. The cluster is thrown away wholesale, so the database
 * itself is left behind rather than dropped.
 */
async function withDatabase<T>(
  cluster: Cluster,
  name: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const admin = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: name,
  });
  await client.connect();
  try {
    // Every fresh database needs the objects a hosted Supabase project ships with (the API roles
    // are cluster-global and already there; the `supabase_realtime` publication is per-database).
    await bootstrapSupabase(client);
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Throw `message` unless the promise rejects; swallows the rejection it was expecting. */
async function expectRejects(promise: Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await promise;
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(message);
}

/** Throw `message` if a table exists — i.e. if a rolled-back migration left it behind. */
async function expectAbsent(client: Client, table: string, message: string): Promise<void> {
  const { rows } = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [`public.${table}`],
  );
  if (rows[0]?.present !== false) throw new Error(message);
}

/** Throw unless the ledger has no row for `name`. */
async function expectUnrecorded(client: Client, name: string): Promise<void> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from ${LEDGER_TABLE} where filename = $1`,
    [name],
  );
  if (rows[0]?.n !== 0) throw new Error(`${name} was recorded as applied despite failing`);
}

/** Throw unless two name lists match exactly, naming the difference. */
function expectSame(label: string, actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) {
    throw new Error(`${label}: expected [${expected.join(', ')}] but got [${actual.join(', ')}]`);
  }
}

/**
 * The deployer's integration suite — the merge pipeline's applier (`src/deploy.ts`) exercised
 * against real PostgreSQL, on its own throwaway databases. These are the behaviours a unit test on
 * the JS side cannot reach: that the SQL actually applies, that the ledger keeps a second run from
 * re-applying it, that a pre-ledger database is baselined instead of re-run from `0001`, that a
 * failing file rolls back whole, and that the ledger stays invisible to the PostgREST API roles.
 */
export async function runDeployAssertions(cluster: Cluster): Promise<AssertionResult[]> {
  const names = allMigrationNames();

  const freshResult = await attempt(
    'deploy applies every migration to an empty database, then is a no-op',
    async () =>
      withDatabase(cluster, 'alfred_deploy_fresh', async (client) => {
        const first = await deployMigrations(client);
        expectSame('first run', first.apply, names);
        if (first.baseline.length > 0) throw new Error('an empty database must not be baselined');
        expectSame('ledger after first run', sorted(await appliedMigrations(client)), names);

        // The whole point of the ledger: running the pipeline again (a second merge, a re-run of
        // the workflow) must apply nothing rather than replay `0001`.
        const second = await deployMigrations(client);
        expectSame('second run', second.apply, []);
        return `${String(names.length)} applied, second run applied 0`;
      }),
  );

  const baselineResult = await attempt(
    'deploy baselines a pre-ledger database instead of re-running its history',
    async () =>
      withDatabase(cluster, 'alfred_deploy_preledger', async (client) => {
        // Reconstruct the live databases as they stood when this deployer landed: the history
        // through the baseline applied by hand, and no ledger table at all.
        await applyMigrations(client, MIGRATIONS_DIR, (file) =>
          throughBaseline(names).includes(path.basename(file)),
        );
        const plan = await deployMigrations(client);
        expectSame('baselined', plan.baseline, throughBaseline(names));
        expectSame('applied', plan.apply, afterBaseline(names));
        expectSame('ledger', sorted(await appliedMigrations(client)), names);
        return `baselined ${String(plan.baseline.length)} through ${BASELINE_MIGRATION}, applied ${String(plan.apply.length)}`;
      }),
  );

  const manualResult = await attempt(
    'a hand-applied migration is recorded, and does not strand the deployer at 0001',
    async () =>
      withDatabase(cluster, 'alfred_deploy_manual', async (client) => {
        // The live databases as they were: full history through the baseline, no ledger. Someone
        // now applies the newest migration by hand (`npm run migrate`) before the merge lands.
        await applyMigrations(client, MIGRATIONS_DIR, (file) =>
          throughBaseline(names).includes(path.basename(file)),
        );
        await recordManualApply(client, BASELINE_MIGRATION);

        // The ledger now has rows, so the deployer trusts it as the whole story — which is only
        // safe because the manual path baselined the history behind that row first.
        const plan = await deployMigrations(client);
        expectSame('applied after a manual apply', plan.apply, afterBaseline(names));
        expectSame('ledger', sorted(await appliedMigrations(client)), names);
        return `hand-applied ${BASELINE_MIGRATION}; the next deploy applied ${String(plan.apply.length)}, not ${String(names.length)}`;
      }),
  );

  const rollbackResult = await attempt(
    'a migration and its ledger row land together, or not at all',
    async () =>
      withDatabase(cluster, 'alfred_deploy_rollback', async (client) => {
        await deployMigrations(client);
        const dir = mkdtempSync(path.join(tmpdir(), 'alfred-deploy-'));
        try {
          // Half 1 — the file itself fails partway: nothing it created may survive, and it must
          // not be recorded. (A file is sent as ONE batch, so Postgres rolls the batch back; run
          // the statements separately instead and `deploy_boom` would outlive the failure.)
          const broken = path.join(dir, '9999_broken.sql');
          writeFileSync(broken, 'create table deploy_boom (id int);\nselect 1 / 0;\n');
          await expectRejects(applyMigration(client, broken), 'a failing migration must reject');
          await expectAbsent(client, 'deploy_boom', 'the failed migration left its table behind');
          await expectUnrecorded(client, '9999_broken.sql');

          // Half 2 — the SQL succeeds but the LEDGER WRITE fails (here: its row already exists).
          // Without the explicit transaction the schema change would stick while the ledger still
          // claimed the file was applied earlier, and the next deploy would replay it blind.
          const conflicted = path.join(dir, '9999_conflict.sql');
          writeFileSync(conflicted, 'create table deploy_conflict (id int);\n');
          await client.query(`insert into ${LEDGER_TABLE} (filename) values ('9999_conflict.sql')`);
          await expectRejects(
            applyMigration(client, conflicted),
            'a duplicate ledger row must reject',
          );
          await expectAbsent(
            client,
            'deploy_conflict',
            'the migration stuck even though its ledger row did not',
          );
          return 'rolled back on a failed statement AND on a failed ledger write';
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
  );

  const grantResult = await attempt(
    'the migration ledger is not readable by the PostgREST API roles',
    async () =>
      withDatabase(cluster, 'alfred_deploy_grants', async (client) => {
        await deployMigrations(client);
        // The ledger sits in `public` so it travels with the schema-scoped backup dump — which
        // also puts it in PostgREST's reach. Only the absence of grants keeps it off the API.
        const denied: string[] = [];
        for (const role of ['anon', 'authenticated']) {
          await client.query(`set role ${role}`);
          try {
            await client.query(`select 1 from ${LEDGER_TABLE}`);
          } catch (error) {
            if (/permission denied/i.test(error instanceof Error ? error.message : '')) {
              denied.push(role);
            }
          } finally {
            await client.query('reset role');
          }
        }
        expectSame('roles denied', denied, ['anon', 'authenticated']);
        return 'anon and authenticated are both denied';
      }),
  );

  return [freshResult, baselineResult, manualResult, rollbackResult, grantResult];
}
