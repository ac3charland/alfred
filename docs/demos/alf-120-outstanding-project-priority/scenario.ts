// ALF-120 demo scenario — spins up a throwaway Postgres, applies every migration exactly as
// production does, seeds a realistic "project with a completed story ranked at the top" backlog,
// then calls the real `create_code_story` RPC and prints where the new story lands. No test
// harness, no assertions — just the query results a reviewer can read.
//
// Run from the repo root: `node docs/demos/alf-120-outstanding-project-priority/scenario.ts`
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const { Client } = pg;

interface Row {
  ref: string;
  project_key: string;
  factory_state: string;
  priority: string;
}

async function backlog(client: pg.Client): Promise<Row[]> {
  const { rows } = await client.query<Row>(
    `select c.ref, p.key as project_key, c.factory_state, c.priority::text as priority
       from code_items c join projects p on p.id = c.project_id
      order by c.priority`,
  );
  return rows;
}

function printBacklog(title: string, rows: Row[]): void {
  process.stdout.write(`${title}\n`);
  for (const r of rows) {
    const hidden = r.factory_state === 'done' || r.factory_state === 'abandoned' ? '  (hidden)' : '';
    process.stdout.write(
      `  ${r.priority.padStart(6)}  ${r.ref.padEnd(6)}  ${r.project_key.padEnd(5)}  ${r.factory_state}${hidden}\n`,
    );
  }
  process.stdout.write('\n');
}

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

  // Two projects. ACME's best-ranked row is a COMPLETED story sitting at the global top (rank 1) —
  // it keeps its priority but is hidden from the Backlog. ACME's visible work starts at rank 5.
  // OTHER has one outstanding story at rank 3, between ACME's done story and ACME's visible top.
  const acme = '10000000-0000-0000-0000-000000000001';
  const other = '10000000-0000-0000-0000-000000000002';
  const acmeEpic = '20000000-0000-0000-0000-000000000001';
  const otherEpic = '20000000-0000-0000-0000-000000000002';
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'ACM', 'Acme', 'ac3charland', 'acme'),
              ($2, 'OTH', 'Other', 'ac3charland', 'other')`,
    [acme, other],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ($1, $2, 'Acme Epic', 1, 'ACM-1'), ($3, $4, 'Other Epic', 1, 'OTH-1')`,
    [acmeEpic, acme, otherEpic, other],
  );

  const mkStory = async (project: string, epic: string): Promise<string> => {
    const { rows } = await client.query<{ ref: string }>(
      `select ref from create_code_story($1, $2, 'seed', null)`,
      [project, epic],
    );
    return rows[0]!.ref;
  };
  const acmeDone = await mkStory(acme, acmeEpic);
  const acmeOpen = await mkStory(acme, acmeEpic);
  const otherOpen = await mkStory(other, otherEpic);
  await client.query(`update code_items set priority = 1, factory_state = 'done' where ref = $1`, [
    acmeDone,
  ]);
  await client.query(`update code_items set priority = 3 where ref = $1`, [otherOpen]);
  await client.query(`update code_items set priority = 5 where ref = $1`, [acmeOpen]);

  printBacklog(
    'Backlog before — the ACM story at rank 1 is done (hidden); ACM’s top VISIBLE story is rank 5:',
    await backlog(client),
  );

  // The owner captures a new ACME story. It must land at the top of ACME's VISIBLE work (above
  // rank 5), NOT above the completed story at the global top and NOT above OTHER's rank-3 story.
  const { rows } = await client.query<{ ref: string; priority: string }>(
    `select ref, priority::text as priority from create_code_story($1, $2, 'ship dark mode', null)`,
    [acme, acmeEpic],
  );
  const created = rows[0]!;
  process.stdout.write(
    `New ACM story ${created.ref} created at priority ${created.priority}.\n\n`,
  );
  printBacklog(
    'Backlog after — the new story sits at the top of ACM’s visible list, still behind OTH at rank 3:',
    await backlog(client),
  );

  const p = Number(created.priority);
  process.stdout.write(
    `Lands above ACM’s top visible story (5): ${String(p < 5)}\n` +
      `Does NOT jump to the whole-Backlog top past OTH’s rank 3: ${String(p > 3)}\n` +
      `Ignored the hidden completed story at rank 1: ${String(p > 1)}\n`,
  );
} finally {
  await client.end();
  cluster.stop();
}
