// Show migration 0028 against a REAL throwaway PostgreSQL: the two columns it adds, and the
// 500-character CHECK refusing an essay. Prints a fixed, deterministic transcript.
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

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

  const { rows: columns } = await client.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_name in ('folders', 'projects') and column_name = 'description'
      order by table_name`,
  );
  for (const row of columns) {
    process.stdout.write(
      `${row.table_name}.${row.column_name}: ${row.data_type}, nullable=${row.is_nullable}, default=${row.column_default ?? 'none'}\n`,
    );
  }

  // A described folder round-trips; an emptied one is stored as NULL, never ''.
  await client.query(
    `insert into folders (name, description) values ('Health', $1)`,
    ['Doctors, dentist, prescriptions, the gym — anything about my body or my health admin.'],
  );
  const { rows: stored } = await client.query(
    `select name, description from folders where name = 'Health'`,
  );
  process.stdout.write(`\nstored: ${stored[0].name} → "${stored[0].description}"\n`);

  // The cap, three layers deep: this is the backstop under the zod .max(500) and the textarea.
  for (const [table, statement] of [
    ['folders', `insert into folders (name, description) values ('Essay', $1)`],
    [
      'projects',
      `insert into projects (key, name, repo_owner, repo_name, description)
         values ('ESY', 'Essay', 'ac3charland', 'alfred', $1)`,
    ],
  ]) {
    try {
      await client.query(statement, ['x'.repeat(501)]);
      process.stdout.write(`${table}: 501 characters ACCEPTED — the cap is missing\n`);
    } catch (error) {
      process.stdout.write(`${table}: 501 characters rejected by ${error.constraint}\n`);
    }
  }

  // 500 is legal — the boundary is inclusive, matching z.string().max(500).
  await client.query(`insert into folders (name, description) values ('At the cap', $1)`, [
    'x'.repeat(500),
  ]);
  process.stdout.write('folders: 500 characters accepted\n');
} finally {
  await client.end();
  cluster.stop();
}
