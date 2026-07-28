import process from 'node:process';

import pg from 'pg';

import { startCluster } from './cluster.ts';
import { applyMigrations, bootstrapSupabase } from './migrate.ts';

/**
 * Print what the committed migrations actually build, without a live database.
 *
 * Stands up the same throwaway cluster the integration suite uses, applies every migration in
 * production's order, and describes the tables you name — columns, constraints, indexes and
 * the grants each API role ends up with. Answering "did that migration land what I think it
 * did?" from the repo alone is the point; it needs no credentials and touches nothing real.
 *
 *   npm run describe -w database -- habits habit_entries
 */

const { Client } = pg;

interface Column {
  column_name: string;
  /** The enum's own name for a `USER-DEFINED` column, which is what a reader wants to see. */
  data_type: string;
  is_nullable: string;
  /** Absent when the column has no default — the DB's `null` is mapped at the query site. */
  column_default?: string | undefined;
}

/** `name  type  not null  default …` — one aligned line per column. */
export function formatColumns(columns: Column[]): string[] {
  const width = Math.max(0, ...columns.map((column) => column.column_name.length));
  return columns.map((column) => {
    const nullability = column.is_nullable === 'NO' ? ' not null' : '';
    const fallback = column.column_default === undefined ? '' : ` default ${column.column_default}`;
    return `  ${column.column_name.padEnd(width)}  ${column.data_type}${nullability}${fallback}`;
  });
}

/** The raw row shape, where an absent default really is a SQL `null`. */
interface ColumnRow extends Omit<Column, 'column_default'> {
  column_default: string | null;
}

async function describe(client: pg.Client, table: string): Promise<string[]> {
  const lines = [table];

  const columns = await client.query<ColumnRow>(
    // information_schema reports an enum column as `USER-DEFINED`; `udt_name` is the enum.
    `select column_name,
            case when data_type = 'USER-DEFINED' then udt_name else data_type end as data_type,
            is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table],
  );
  lines.push(
    ...formatColumns(
      columns.rows.map((row) => ({ ...row, column_default: row.column_default ?? undefined })),
    ),
  );

  const constraints = await client.query<{ definition: string }>(
    `select conname || ': ' || pg_get_constraintdef(oid) as definition
       from pg_constraint where conrelid = $1::regclass order by conname`,
    [table],
  );
  for (const row of constraints.rows) lines.push(`  constraint ${row.definition}`);

  const indexes = await client.query<{ indexdef: string }>(
    `select indexdef from pg_indexes where schemaname = 'public' and tablename = $1
      order by indexname`,
    [table],
  );
  for (const row of indexes.rows) lines.push(`  ${row.indexdef}`);

  const rls = await client.query<{ relrowsecurity: boolean }>(
    `select relrowsecurity from pg_class where oid = $1::regclass`,
    [table],
  );
  lines.push(`  row level security: ${rls.rows[0]?.relrowsecurity === true ? 'enabled' : 'OFF'}`);

  const policies = await client.query<{ policyname: string; roles: string }>(
    `select policyname, array_to_string(roles, ', ') as roles
       from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`,
    [table],
  );
  for (const row of policies.rows) lines.push(`  policy "${row.policyname}" to ${row.roles}`);

  const grants = await client.query<{ grantee: string; privileges: string }>(
    `select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
       from information_schema.role_table_grants
      where table_schema = 'public' and table_name = $1
        and grantee in ('anon', 'authenticated', 'service_role')
      group by grantee order by grantee`,
    [table],
  );
  for (const row of grants.rows) lines.push(`  grant ${row.privileges} to ${row.grantee}`);

  return lines;
}

async function main(tables: string[]): Promise<number> {
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
    await applyMigrations(client);
    for (const table of tables) {
      const lines = await describe(client, table);
      process.stdout.write(`${lines.join('\n')}\n\n`);
    }
    return 0;
  } finally {
    await client.end();
    cluster.stop();
  }
}

// Only run the CLI when this file IS the entry point — importing it (the unit test does)
// must not print usage or set a failing exit code.
if (import.meta.filename === process.argv[1]) {
  const tables = process.argv.slice(2);
  if (tables.length === 0) {
    process.stderr.write('usage: npm run describe -w database -- <table> [table…]\n');
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = await main(tables);
    } catch (error) {
      process.stderr.write(`describe: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
