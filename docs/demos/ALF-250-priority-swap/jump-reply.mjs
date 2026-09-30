// Boot a throwaway Postgres, apply the migrations — every one, or all but the ones named on the
// command line — and jump the bottom story of a project to its top when the project's top rank
// and the rank above it are adjacent doubles, so `move_code_priority_in_project` has no midpoint
// to take and must respace the whole Backlog first. Print what the RPC's reply carried: an open
// Backlog hears the jump's reply in order, but every other story's new rank only from Realtime,
// which usually trails it.
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const ALFRED = '00000000-0000-4000-8000-000000000001';
const RELAY = '00000000-0000-4000-8000-000000000002';

const leftOut = process.argv.slice(2);
const cluster = await startCluster();
const client = new pg.Client({
  host: cluster.host,
  port: cluster.port,
  user: cluster.user,
  database: cluster.database,
});

const ranks = async () => {
  const { rows } = await client.query(
    `select item_id, ref, priority, priority_rev from code_items order by priority`,
  );
  return rows;
};

try {
  await client.connect();
  await bootstrapSupabase(client);
  await applyMigrations(client, undefined, (file) => !leftOut.some((name) => file.includes(name)));
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred'),
              ($2, 'REL', 'Relay', 'ac3charland', 'relay')`,
    [ALFRED, RELAY],
  );
  await client.query('set role authenticated');
  const relayEpic = await client.query(`select id from create_epic($1, 'Relay core')`, [RELAY]);
  const alfredEpic = await client.query(`select id from create_epic($1, 'Reader')`, [ALFRED]);
  await client.query(`select create_code_story($1, $2, 'A Relay story ranked above Alfred')`, [
    RELAY,
    relayEpic.rows[0].id,
  ]);
  for (const title of ['Weekly plan items', 'Send a Reader post to Instapaper', 'Archive a post', 'Star a post']) {
    await client.query(`select create_code_story($1, $2, $3)`, [ALFRED, alfredEpic.rows[0].id, title]);
  }
  await client.query('reset role');

  // 60000 sits in [2^15, 2^16), where the gap between one double and the next is 2^-37: the
  // Relay story and Alfred's top story take those two neighbouring values, so no rank fits
  // between them. The other Alfred stories sit well below.
  const refs = (await ranks()).map((row) => row.ref).sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  const relayTop = refs.find((ref) => ref.startsWith('REL-'));
  const [alfredTop, ...alfredRest] = refs.filter((ref) => ref.startsWith('ALF-'));
  await client.query(`update code_items set priority = 60000 where ref = $1`, [relayTop]);
  await client.query(`update code_items set priority = 60000 + power(2::float8, -37) where ref = $1`, [alfredTop]);
  for (const [index, ref] of alfredRest.entries()) {
    await client.query(`update code_items set priority = $1 where ref = $2`, [61000 + index * 1000, ref]);
  }

  const seeded = await ranks();
  const [a, b] = seeded.slice(0, 2).map((row) => row.priority);
  console.log(`Backlog: ${seeded.map((row) => `${row.ref} @ ${row.priority}`).join(', ')}`);
  console.log(
    `The two top ranks are adjacent doubles: their midpoint is ${(a + b) / 2}, ` +
      `${(a + b) / 2 === a || (a + b) / 2 === b ? 'one of them' : 'a rank of its own'}`,
  );

  const jumped = alfredRest.at(-1);
  console.log(`Jump ${jumped} to the top of Alfred: move_code_priority_in_project('${jumped}', true)`);
  await client.query('set role authenticated');
  const reply = await client.query(`select * from move_code_priority_in_project($1, true)`, [jumped]);
  await client.query('reset role');

  const stored = await ranks();
  const byId = new Map(stored.map((row) => [row.item_id, row]));
  const others = stored.filter((row) => row.ref !== jumped);
  const carried = (row) => reply.rows.some((replied) => replied.item_id === row.item_id);
  const wasBefore = new Map(seeded.map((row) => [row.item_id, row.priority]));
  const renumbered = others.filter((row) => row.priority !== wasBefore.get(row.item_id));
  const current = reply.rows.filter(
    (row) =>
      byId.get(row.item_id)?.priority === row.priority &&
      byId.get(row.item_id)?.priority_rev === row.priority_rev,
  );

  console.log(`Stories that exist: ${stored.length}`);
  console.log(
    `Rows the reply carried: ${reply.rows.length}` +
      ` (${reply.rows.map((row) => row.ref).sort().join(', ')})`,
  );
  console.log(`Other stories the respace renumbered: ${renumbered.length} of ${others.length}`);
  console.log(`Renumbered stories in the reply: ${renumbered.filter(carried).length} of ${renumbered.length}`);
  console.log(`Reply rows at their stored rank and revision: ${current.length} of ${reply.rows.length}`);
  console.log(`Ranks now: ${stored.map((row) => `${row.ref} @ ${row.priority}`).join(', ')}`);

  // The ranks are whole again, so the next jump fits a midpoint: no respace, one row in the reply.
  const plainTarget = alfredRest[0];
  await client.query('set role authenticated');
  const plain = await client.query(`select * from move_code_priority_in_project($1, true)`, [plainTarget]);
  await client.query('reset role');
  const afterPlain = new Map((await ranks()).map((row) => [row.item_id, row]));
  const restamped = stored.filter(
    (row) => row.ref !== plainTarget && afterPlain.get(row.item_id)?.priority_rev !== row.priority_rev,
  );
  console.log(
    `Jump ${plainTarget} to the top of Alfred (no respace needed): reply carried ${plain.rows.length} row` +
      `${plain.rows.length === 1 ? '' : 's'} (${plain.rows.map((row) => row.ref).sort().join(', ')}), ` +
      `other stories re-stamped: ${restamped.length}`,
  );
} finally {
  await client.end();
  cluster.stop();
}
