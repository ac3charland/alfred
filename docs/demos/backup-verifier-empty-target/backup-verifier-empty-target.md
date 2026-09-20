---
branch: claude/alfred-backup-ci-failure-tij1r1
---

# The nightly backup's verify database is an empty target

*2026-09-20T13:51:51.046Z*

Both matrix jobs of the nightly `Backup` workflow have failed since 2026-09-19 (runs #61 and #62), so neither instance's dump reached R2 on those days. The dump itself was fine — 2.4 MB, taken and gzipped — and the run died in step 2, the in-job restore check:

> `  dump ok — 2435314 bytes gzipped`
> `› [personal] verifying restore into throwaway Postgres…`
> `ERROR:  duplicate key value violates unique constraint "reader_health_pkey"`
> `DETAIL:  Key (id)=(1) already exists.`
> `CONTEXT:  COPY reader_health, line 1`
> `backup: backup step failed (exit 3)`

The verify database is built by applying the committed migrations. `0035_reader` (merged 2026-09-18, PR #339) does not only declare a table — it seeds one:

```bash
grep -n -B 2 "insert into reader_health" database/migrations/0035_reader.sql
```

```output
169-
170--- The tick only ever PATCHes this row — insert it here so there is always exactly one.
171:insert into reader_health (id) values (1);
```

So the verifier planted `id = 1` itself, and the dump's own copy of that row had nowhere to land. The restore runs `--single-transaction`, so that one collision aborted the whole load — and a sound backup was discarded rather than uploaded.

`buildVerifySchema` now empties the schema it just built: the migrations are there to supply the *shape* production's data lands in, and any rows they seed on the way are residue standing in the payload's path. Below, a throwaway cluster builds the verify database both ways and runs the nightly's own restore command against each.

```bash
cat > /tmp/verify-target.mjs <<'JS'
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { startCluster } from './database/src/cluster.ts';
import { buildVerifySchema } from './database/src/backup.ts';
import { applyMigrations, bootstrapSupabase } from './database/src/migrate.ts';
import { ensureLedger } from './database/src/deploy.ts';

// The dump's reader_health section, exactly as the nightly's pg_dump writes it.
writeFileSync('/tmp/data.sql', `COPY "public"."reader_health" ("id", "last_run_at", "last_success_at", "last_error", "last_error_at") FROM stdin;
1	2026-09-20 08:17:00+00	2026-09-20 08:17:00+00	\\N	\\N
\\.
`);

const cluster = await startCluster();
const admin = new pg.Client({ host: cluster.host, port: cluster.port, user: cluster.user, database: cluster.database });
await admin.connect();

async function restoreInto(label, database, build) {
  await admin.query(`create database ${database}`);
  const url = `postgres://${cluster.user}@${cluster.host}:${cluster.port}/${database}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await build(client);
  const { rows } = await client.query('select count(*)::int as n from reader_health');
  await client.end();
  // The nightly's own restore command, verbatim from database/src/backup.ts.
  const load = spawnSync('bash', ['-c',
    `{ printf 'set session_replication_role = replica;\\n'; cat /tmp/data.sql; } | psql "${url}" -v ON_ERROR_STOP=1 --single-transaction --quiet`],
    { encoding: 'utf8' });
  console.log(`${label}: verify schema holds ${rows[0].n} reader_health row(s) before the load`);
  console.log(`${label}: restore exited ${load.status}`);
  for (const line of load.stderr.trim().split('\n').filter(Boolean).slice(0, 3)) console.log(`  ${line}`);
}

// How the verify schema was built until this fix: migrations + ledger, seeded rows and all.
await restoreInto('before', 'verify_before', async (client) => {
  await bootstrapSupabase(client);
  await applyMigrations(client);
  await ensureLedger(client);
});
// How buildVerifySchema now ships: the same schema, then emptied.
await restoreInto('after ', 'verify_after', buildVerifySchema);

await admin.end();
cluster.stop();
JS
node --input-type=module -e "$(cat /tmp/verify-target.mjs)"
```

```output
before: verify schema holds 1 reader_health row(s) before the load
before: restore exited 3
  ERROR:  duplicate key value violates unique constraint "reader_health_pkey"
  DETAIL:  Key (id)=(1) already exists.
  CONTEXT:  COPY reader_health, line 1
after : verify schema holds 0 reader_health row(s) before the load
after : restore exited 0
```

The fix is general, not a patch for one table: every base table in `public` is emptied, so the next migration that seeds a row cannot cost another night's backup. The statement the verifier now issues:

The fix is general, not a patch for one table: every base table in `public` is emptied, so the next migration that seeds a row cannot cost another night's backup.

```bash
cat > /tmp/verify-empty.mjs <<'JS'
import pg from 'pg';
import { startCluster } from './database/src/cluster.ts';
import { buildVerifySchema } from './database/src/backup.ts';

const cluster = await startCluster();
const admin = new pg.Client({ host: cluster.host, port: cluster.port, user: cluster.user, database: cluster.database });
await admin.connect();
await admin.query('create database verify_all');
const client = new pg.Client({ host: cluster.host, port: cluster.port, user: cluster.user, database: 'verify_all' });
await client.connect();

await buildVerifySchema(client);

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
const populated = [];
for (const { table_name } of tables) {
  const { rows } = await client.query(`select count(*)::int as n from public."${table_name}"`);
  if (rows[0].n > 0) populated.push(`${table_name} (${rows[0].n})`);
}
console.log(`public base tables built: ${tables.length}`);
console.log(`tables carrying rows of the verifier's own: ${populated.length === 0 ? 'none' : populated.join(', ')}`);

await client.end(); await admin.end(); cluster.stop();
JS
node --input-type=module -e "$(cat /tmp/verify-empty.mjs)"
```

```output
public base tables built: 21
tables carrying rows of the verifier's own: none
```

Nothing about the dump or the upload changed — only what the verify database looks like when the dump's data arrives. The two nights already lost (2026-09-19, 2026-09-20) need a manual **Actions → Backup → Run workflow** once this merges; the `monthly/<instance>/2026-09` slot still holds the last good run from the 18th.
