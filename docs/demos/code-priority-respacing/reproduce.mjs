// Reproduce the production dispatch outage, and show 0031 clearing it.
//
// Stands up the same throwaway Postgres the integration suite uses, TWICE: once with the
// migrations as they stood before this branch (0001–0030), once with 0031 applied. Both runs
// seed the identical exhausted state — two Backlog ranks that are ADJACENT doubles, with no
// representable value left between them — and then run the dispatch a browser makes.
//
//   node docs/demos/code-priority-respacing/reproduce.mjs
//
// No credentials, no network: the cluster is created and torn down here.
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const GAP = '11111111-1111-4111-8111-111111111111';
const GAP_EPIC = '22222222-2222-4222-8222-222222222222';
const RAN = '33333333-3333-4333-8333-333333333333';
const RAN_EPIC = '44444444-4444-4444-8444-444444444444';

/** Run one scenario against a fresh cluster carrying exactly the migrations `include` admits. */
async function run(label, include) {
  const cluster = await startCluster();
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  console.log(`\n── ${label} ──`);
  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client, undefined, include);

    // Two projects: GAP holds the rank immediately above RAN's top, so a new RAN story has to
    // land between them.
    await client.query(
      `insert into projects (id, key, name, repo_owner, repo_name)
         values ($1, 'GAP', 'Gapless', 'ac3charland', 'gapless'),
                ($2, 'RAN', 'Ranked', 'ac3charland', 'ranked')`,
      [GAP, RAN],
    );
    await client.query(
      `insert into epics (id, project_id, name, ref_number, ref)
         values ($1, $2, 'Gap Epic', 1, 'GAP-1'), ($3, $4, 'Ran Epic', 1, 'RAN-1')`,
      [GAP_EPIC, GAP, RAN_EPIC, RAN],
    );
    const story = async (title, project, epic) => {
      const { rows } = await client.query(`select ref from create_code_story($1, $2, $3)`, [
        project,
        epic,
        title,
      ]);
      return rows[0].ref;
    };
    const above = await story('the rank above', GAP, GAP_EPIC);
    const top = await story('the project top', RAN, RAN_EPIC);

    // 20000 lives in [2^14, 2^15), so its ULP is 2^-38: `20000 + 2^-38` is the very NEXT double.
    // This is what fifty midpoint insertions into one project converge on.
    await client.query(`update code_items set priority = 20000 where ref = $1`, [above]);
    await client.query(
      `update code_items set priority = 20000 + power(2::float8, -38) where ref = $1`,
      [top],
    );
    const { rows: seeded } = await client.query(
      `select ref, priority::text as priority from code_items order by priority`,
    );
    for (const row of seeded) console.log(`  seeded ${row.ref} at ${row.priority}`);
    const { rows: math } = await client.query(
      `select ((a + b) / 2.0)::text as midpoint, (a + b) / 2.0 = a as collides
         from (select min(priority) as a, max(priority) as b from code_items) as t`,
    );
    console.log(`  midpoint of the two = ${math[0].midpoint} → collides: ${math[0].collides}`);

    // The dispatch itself, as the browser's role.
    const { rows: item } = await client.query(
      `insert into items (title, item_type) values ('a story with nowhere to land', 'task')
         returning id`,
    );
    await client.query(`set role authenticated`);
    try {
      const { rows: gated } = await client.query(
        `select ref, priority::text as priority from enter_code_module($1, $2, $3)`,
        [item[0].id, RAN, RAN_EPIC],
      );
      console.log(`  dispatch → OK, ${gated[0].ref} landed at ${gated[0].priority}`);
    } catch (error) {
      console.log(`  dispatch → ${error.code} ${error.message}`);
      return;
    } finally {
      await client.query(`reset role`);
    }

    const { rows: after } = await client.query(
      `select ref, priority::text as priority from code_items order by priority`,
    );
    console.log(`  Backlog now: ${after.map((r) => `${r.ref}=${r.priority}`).join('  ')}`);
  } finally {
    await client.end();
    cluster.stop();
  }
}

const before = (file) => !file.endsWith('0031_respace_code_priority.sql');
await run('migrations 0001–0030 (production, before this branch)', before);
await run('every migration, 0031 included', () => true);
