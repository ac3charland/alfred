import path from 'node:path';

import pg, { type Client } from 'pg';

import {
  buildVerifySchema,
  copiedTables,
  reconcileDriftStatements,
  schemaDrift,
} from './backup.ts';
import { deployMigrations } from './deploy.ts';
import { MIGRATIONS_DIR, applyMigrations, bootstrapSupabase } from './migrate.ts';

/** One integration check's outcome. `detail` is evidence on success, the failure reason otherwise. */
export interface AssertionResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

// Fixed seed identities (the ALF-4 "Bug Fixes" epic the screenshot created a bug under).
const PROJECT = '11111111-1111-1111-1111-111111111111';
const EPIC = '22222222-2222-2222-2222-222222222222';

// A second project (ALF-110), so the project-scoped assertions have another project's stories
// that must NOT move when this one is re-ranked.
const PROJECT_2 = '55555555-5555-5555-5555-555555555555';
const EPIC_2 = '66666666-6666-6666-6666-666666666666';

/**
 * Run `fn` with the connection's role temporarily switched, then restore it. RLS and table
 * GRANTs apply as `role` (not the superuser session), so this is what exercises the real
 * authorization a browser hits. The role names are code literals, never user input.
 */
async function asRole<T>(client: Client, role: string, fn: () => Promise<T>): Promise<T> {
  await client.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await client.query('reset role');
  }
}

/** Wrap an assertion so a thrown error (or a rejected query) becomes a failed result, not a crash. */
export async function attempt(name: string, fn: () => Promise<string>): Promise<AssertionResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Seed the one project + epic the code-story assertions create stories under. */
async function seed(client: Client): Promise<void> {
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'ALF', 'Alfred', 'ac3charland', 'alfred')`,
    [PROJECT],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ($1, $2, 'Bug Fixes', 4, 'ALF-4')`,
    [EPIC, PROJECT],
  );
}

/** Create a code story as `authenticated` and return its ref + priority (the modal's path). */
async function createStory(
  client: Client,
  title: string,
  project: string = PROJECT,
  epic: string = EPIC,
): Promise<{ ref: string; priority: string }> {
  const { rows } = await asRole(client, 'authenticated', () =>
    client.query<{ ref: string; priority: string }>(
      `select ref, priority from create_code_story($1, $2, $3)`,
      [project, epic, title],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('create_code_story returned no row');
  return row;
}

/** Read one story's current priority by ref, as a number (the fractional ALF-110 rank). */
async function priorityOf(client: Client, ref: string): Promise<number> {
  const { rows } = await client.query<{ priority: number }>(
    `select priority from code_items where ref = $1`,
    [ref],
  );
  const priority = rows[0]?.priority;
  if (priority === undefined) throw new Error(`no such story: ${ref}`);
  return priority;
}

/** The migration that introduced `items.dispatched_at` — the split point of the backfill replay. */
const DISPATCH_MIGRATION = '0026_inbox_dispatch.sql';

/**
 * Replay the migration history around the dispatch migration on a throwaway database: everything
 * BEFORE it, then a seeded pre-residency world, then the migration itself. A backfill only ever
 * touches rows that already existed, so it can't be judged on the main connection, where every
 * migration has already run against an empty schema.
 *
 * Returns one row per seeded item: its title and whether the backfill dispatched it.
 */
async function replayDispatchBackfill(
  client: Client,
): Promise<{ title: string; dispatched: boolean }[]> {
  // A code literal, never user input — same footing as the `set role` interpolation above.
  const database = 'alfred_dispatch_backfill';
  await client.query(`drop database if exists ${database}`);
  await client.query(`create database ${database}`);
  const probe = new pg.Client({
    host: client.host,
    port: client.port,
    user: client.user,
    database,
  });
  await probe.connect();
  try {
    await bootstrapSupabase(probe);
    await applyMigrations(
      probe,
      MIGRATIONS_DIR,
      (file) => path.basename(file) < DISPATCH_MIGRATION,
    );
    // The world as it stood when "in the Inbox" still meant "has no folder": a filed task with a
    // subtask beneath it, and a loose capture.
    const { rows: folderRows } = await probe.query<{ id: string }>(
      `insert into folders (name) values ('Health') returning id`,
    );
    const folder = folderRows[0]?.id;
    if (folder === undefined) throw new Error('could not seed a folder');
    const { rows: parentRows } = await probe.query<{ id: string }>(
      `insert into items (title, item_type, folder_id) values ('filed task', 'task', $1)
         returning id`,
      [folder],
    );
    const parent = parentRows[0]?.id;
    if (parent === undefined) throw new Error('could not seed a filed task');
    await probe.query(
      `insert into items (title, item_type, folder_id, parent_id)
         values ('filed subtask', 'task', $1, $2)`,
      [folder, parent],
    );
    await probe.query(`insert into items (title, item_type) values ('inbox capture', 'task')`);

    await applyMigrations(
      probe,
      MIGRATIONS_DIR,
      (file) => path.basename(file) === DISPATCH_MIGRATION,
    );
    const { rows } = await probe.query<{ title: string; dispatched: boolean }>(
      `select title, dispatched_at is not null as dispatched from items order by title`,
    );
    return rows;
  } finally {
    await probe.end();
  }
}

/**
 * Create an empty database on this cluster and return a live client on it, seeded with the objects
 * a hosted Supabase project ships with and nothing else. Returned rather than scoped to a callback
 * so a caller can hold two of them open side by side; the caller ends the client, and the cluster
 * is thrown away wholesale rather than the database dropped.
 */
async function throwawayDatabase(client: Client, database: string): Promise<Client> {
  // The name is a code literal, never user input — same footing as the `set role` interpolation above.
  await client.query(`drop database if exists ${database}`);
  await client.query(`create database ${database}`);
  const probe = new pg.Client({
    host: client.host,
    port: client.port,
    user: client.user,
    database,
  });
  await probe.connect();
  await bootstrapSupabase(probe);
  return probe;
}

/**
 * Stand the nightly backup's verify database up as it stood the day it broke: every migration
 * BEFORE the dispatch one, i.e. a repo that has not yet caught up with a production database that
 * already has `items.dispatched_at`. Returns a live client on it; the caller ends it.
 */
async function staleVerifyDatabase(client: Client): Promise<Client> {
  const probe = await throwawayDatabase(client, 'alfred_backup_drift');
  await applyMigrations(probe, MIGRATIONS_DIR, (file) => path.basename(file) < DISPATCH_MIGRATION);
  return probe;
}

/** The public schema's base-table columns of a database, keyed by table (what the verifier sees). */
async function publicColumns(client: Client): Promise<Map<string, string[]>> {
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

/** Seed the second project (ALF-110) used to prove project-scoped moves leave it undisturbed. */
async function seedSecondProject(client: Client): Promise<void> {
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name)
       values ($1, 'OTH', 'Other', 'ac3charland', 'other')`,
    [PROJECT_2],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ($1, $2, 'Other Epic', 1, 'OTH-1')`,
    [EPIC_2, PROJECT_2],
  );
}

/**
 * The integration suite: a small, high-value set that exercises real-Postgres semantics the
 * JS mock can't — the two grant/constraint bugs (0008, 0007) plus RLS read/write enforcement.
 * Runs sequentially on one connection; each check is independent of the others' assertions.
 */
export async function runAssertions(client: Client): Promise<AssertionResult[]> {
  await seed(client);

  // Sequential by design: each check builds on the DB state the previous ones left (the
  // RLS-read check needs the rows the create checks inserted). Bind each result and return
  // them as one literal rather than mutating an array in place.
  const createStoryResult = await attempt(
    'create_code_story lands a new story at top priority (ALF-71)',
    async () => {
      // A fresh story must outrank every story already in the Backlog (lower = higher rank),
      // not append to the bottom. Seed a baseline first, then prove the next one beats it.
      const baseline = await createStory(client, 'older story');
      const { ref, priority } = await createStory(client, 'Bug created from epic');
      if (!priority) throw new Error('no priority allocated');
      if (!(Number(priority) < Number(baseline.priority)))
        throw new Error(`new story priority ${priority} not above baseline ${baseline.priority}`);
      return `baseline=${baseline.priority}, new=${priority} (ref=${ref})`;
    },
  );

  const enterModuleResult = await attempt(
    'enter_code_module lands a gated story at top priority (ALF-71)',
    async () => {
      const inserted = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type) values ('inbox item', 'unclassified') returning id`,
        ),
      );
      const itemId = inserted.rows[0]?.id;
      if (!itemId) throw new Error('item insert returned no id');
      const before = await client.query<{ min: string }>(
        `select min(priority) as min from code_items`,
      );
      const minBefore = Number(before.rows[0]?.min);
      const { rows } = await asRole(client, 'authenticated', () =>
        client.query<{ ref: string; priority: string }>(
          `select ref, priority from enter_code_module($1, $2, $3)`,
          [itemId, PROJECT, EPIC],
        ),
      );
      const row = rows[0];
      if (!row?.priority) throw new Error('no priority allocated');
      if (!(Number(row.priority) < minBefore))
        throw new Error(`gated priority ${row.priority} not above min ${String(minBefore)}`);
      return `min before=${String(minBefore)}, gated=${row.priority} (ref=${row.ref})`;
    },
  );

  const swapResult = await attempt(
    'swap_code_priority swaps adjacent ranks without a 409 (0007)',
    async () => {
      const a = await createStory(client, 'story A');
      const b = await createStory(client, 'story B');
      const beforeA = a.priority;
      const beforeB = b.priority;
      await asRole(client, 'authenticated', () =>
        client.query(`select swap_code_priority($1, $2)`, [a.ref, b.ref]),
      );
      const after = await client.query<{ ref: string; priority: string }>(
        `select ref, priority from code_items where ref = any($1)`,
        [[a.ref, b.ref]],
      );
      const afterMap = new Map(after.rows.map((r): [string, string] => [r.ref, r.priority]));
      if (afterMap.get(a.ref) !== beforeB || afterMap.get(b.ref) !== beforeA) {
        throw new Error(
          `priorities not swapped (before ${beforeA}/${beforeB}, after ${String(afterMap.get(a.ref))}/${String(afterMap.get(b.ref))})`,
        );
      }
      return `${a.ref}:${beforeA}→${beforeB}, ${b.ref}:${beforeB}→${beforeA}`;
    },
  );

  const moveResult = await attempt(
    'move_code_priority jumps a story past both extremes (0009)',
    async () => {
      await createStory(client, 'story X');
      await createStory(client, 'story Y');
      const z = await createStory(client, 'story Z');
      // The min over every OTHER live story (what the RPC's to-top reads). Querying it rather
      // than assuming z starts lowest keeps this independent of the new-story default direction.
      const minOthers = await client.query<{ min: string }>(
        `select min(priority) as min from code_items where ref <> $1`,
        [z.ref],
      );
      const minBefore = Number(minOthers.rows[0]?.min);
      // Jump z to the top → strictly below every other live priority.
      await asRole(client, 'authenticated', () =>
        client.query(`select move_code_priority($1, $2)`, [z.ref, true]),
      );
      const top = await client.query<{ priority: string }>(
        `select priority from code_items where ref = $1`,
        [z.ref],
      );
      const zTop = Number(top.rows[0]?.priority);
      if (!(zTop < minBefore))
        throw new Error(`to-top priority ${String(zTop)} not below min ${String(minBefore)}`);
      // Now jump it to the bottom → strictly above every other live priority.
      const maxOthers = await client.query<{ max: string }>(
        `select max(priority) as max from code_items where ref <> $1`,
        [z.ref],
      );
      const maxBefore = Number(maxOthers.rows[0]?.max);
      await asRole(client, 'authenticated', () =>
        client.query(`select move_code_priority($1, $2)`, [z.ref, false]),
      );
      const bottom = await client.query<{ priority: string }>(
        `select priority from code_items where ref = $1`,
        [z.ref],
      );
      const zBottom = Number(bottom.rows[0]?.priority);
      if (!(zBottom > maxBefore))
        throw new Error(`to-bottom priority ${String(zBottom)} not above max ${String(maxBefore)}`);
      return `${z.ref}: top=${String(zTop)} → bottom=${String(zBottom)}`;
    },
  );

  await seedSecondProject(client);

  const projectScopedMoveResult = await attempt(
    'move_code_priority_in_project reorders within a project without crossing a ' +
      'better-ranked story from another project (ALF-110)',
    async () => {
      // A story in the OTHER project, ranked better than anything created below (the very first
      // story in a fresh project lands at the global top — ALF-110's no-anchor fallback).
      const other = await createStory(client, 'other project story', PROJECT_2, EPIC_2);
      // Two stories in the seeded project; p2 is created after p1 so p1 starts as the project's
      // current top.
      const p1 = await createStory(client, 'own project story one');
      const p2 = await createStory(client, 'own project story two');
      const otherBefore = await priorityOf(client, other.ref);
      const p1Before = await priorityOf(client, p1.ref);

      await asRole(client, 'authenticated', () =>
        client.query(`select move_code_priority_in_project($1, $2)`, [p2.ref, true]),
      );

      const otherAfter = await priorityOf(client, other.ref);
      const p1After = await priorityOf(client, p1.ref);
      const p2After = await priorityOf(client, p2.ref);

      if (otherAfter !== otherBefore)
        throw new Error(
          `other project's story moved (before ${String(otherBefore)}, after ${String(otherAfter)})`,
        );
      if (p1After !== p1Before)
        throw new Error(
          `p1 moved when only p2 should (before ${String(p1Before)}, after ${String(p1After)})`,
        );
      if (!(p2After < p1After))
        throw new Error(
          `p2 (${String(p2After)}) not above p1 (${String(p1After)}) — not top of project`,
        );
      if (!(p2After > otherBefore))
        throw new Error(
          `p2 (${String(p2After)}) crossed the other project's better-ranked story (${String(otherBefore)})`,
        );

      return `other=${String(otherBefore)} (unmoved), p1=${String(p1After)}, p2=${String(p2After)} (now top of project, still behind other)`;
    },
  );

  const projectDefaultResult = await attempt(
    'create_code_story lands a new story at the top of its PROJECT, not the whole ' +
      'Backlog (ALF-110)',
    async () => {
      // The other project's best story from the previous check outranks everything in the
      // seeded project — prove a fresh story here lands ahead of its own project's stories but
      // does NOT leapfrog the other project's better rank.
      const otherBest = await client.query<{ min: string }>(
        `select min(priority) as min from code_items where project_id = $1`,
        [PROJECT_2],
      );
      const otherBestBefore = Number(otherBest.rows[0]?.min);
      const projectBefore = await client.query<{ min: string }>(
        `select min(priority) as min from code_items where project_id = $1`,
        [PROJECT],
      );
      const projectMinBefore = Number(projectBefore.rows[0]?.min);

      const fresh = await createStory(client, 'freshly captured story');
      const freshPriority = await priorityOf(client, fresh.ref);

      if (!(freshPriority < projectMinBefore))
        throw new Error(
          `new story (${String(freshPriority)}) not above its project's prior top (${String(projectMinBefore)})`,
        );
      if (!(freshPriority > otherBestBefore))
        throw new Error(
          `new story (${String(freshPriority)}) leapfrogged the other project's best rank (${String(otherBestBefore)})`,
        );

      return `other project best=${String(otherBestBefore)}, project top before=${String(projectMinBefore)}, new=${String(freshPriority)}`;
    },
  );

  const inProjectRpcContractResult = await attempt(
    'move_code_priority_in_project is exposed to the PostgREST RPC contract — present, security ' +
      'invoker, granted to the API roles, with the (p_ref, p_to_top) args the double-chevron ' +
      'move resolves it by (ALF-119)',
    async () => {
      // The prod 500 — "Could not find the function public.move_code_priority_in_project(p_ref,
      // p_to_top) in the schema cache" — was PostgREST failing to resolve this RPC because migration
      // 0014 never reached the database. PostgREST matches an rpc() call by the function NAME and its
      // argument NAMES, and needs EXECUTE granted to the calling API role, so pin exactly that
      // contract. The ALF-119 comment also proves the 0015 remediation migration is in the chain
      // (its schema-cache reload leaves no other queryable trace).
      const { rows } = await client.query<{
        args: string;
        secdef: boolean;
        anon_exec: boolean;
        auth_exec: boolean;
        sr_exec: boolean;
        description: string | null;
      }>(
        `select pg_get_function_identity_arguments(p.oid) as args,
                p.prosecdef as secdef,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as sr_exec,
                obj_description(p.oid, 'pg_proc') as description
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'move_code_priority_in_project'`,
      );
      if (rows.length !== 1)
        throw new Error(
          `expected exactly one move_code_priority_in_project, found ${String(rows.length)}`,
        );
      const fn = rows[0];
      if (!fn) throw new Error('no function row returned');
      if (fn.args !== 'p_ref text, p_to_top boolean')
        throw new Error(`args are "${fn.args}", not the (p_ref, p_to_top) PostgREST resolves by`);
      if (fn.secdef)
        throw new Error('function is security definer; must be security invoker so RLS applies');
      if (!fn.anon_exec || !fn.auth_exec || !fn.sr_exec)
        throw new Error(
          `EXECUTE not granted to all API roles (anon=${String(fn.anon_exec)}, authenticated=${String(fn.auth_exec)}, service_role=${String(fn.sr_exec)})`,
        );
      if (!fn.description?.includes('ALF-119'))
        throw new Error(
          'move_code_priority_in_project lacks the ALF-119 schema-cache remediation comment (migration 0015 not applied)',
        );
      return `args=(${fn.args}), security invoker, granted to anon/authenticated/service_role`;
    },
  );

  const outstandingProjectDefaultResult = await attempt(
    'create_code_story lands above the project’s top OUTSTANDING story, ignoring a ' +
      'completed story ranked better (ALF-120)',
    async () => {
      // Two throwaway projects with hand-set priorities so the math is deterministic regardless of
      // the state prior checks left. DUN holds a DONE story ranked BEST in its project (1000) plus
      // an outstanding story at 3000; LEF (another project) has an outstanding story at 2000,
      // sitting BETWEEN them. A fresh DUN story must land above DUN's top OUTSTANDING (3000) but
      // must NOT be dragged past LEF's 2000 by the hidden completed story — the ALF-120 bug counted
      // the done story as the project top and inserted near the global top instead.
      const projectDun = '77777777-7777-7777-7777-777777777777';
      const epicDun = '88888888-8888-8888-8888-888888888888';
      const projectLef = '99999999-9999-9999-9999-999999999999';
      const epicLef = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await client.query(
        `insert into projects (id, key, name, repo_owner, repo_name)
           values ($1, 'DUN', 'Dunder', 'ac3charland', 'dunder'),
                  ($2, 'LEF', 'Leftpad', 'ac3charland', 'leftpad')`,
        [projectDun, projectLef],
      );
      await client.query(
        `insert into epics (id, project_id, name, ref_number, ref)
           values ($1, $2, 'Dun Epic', 1, 'DUN-1'), ($3, $4, 'Lef Epic', 1, 'LEF-1')`,
        [epicDun, projectDun, epicLef, projectLef],
      );

      const doneStory = await createStory(client, 'completed dun story', projectDun, epicDun);
      const openStory = await createStory(client, 'outstanding dun story', projectDun, epicDun);
      const otherStory = await createStory(client, 'leftpad story', projectLef, epicLef);
      // Pin exact ranks (unique index holds): done=1000, other=2000, open=3000.
      await client.query(
        `update code_items set priority = 1000, factory_state = 'done' where ref = $1`,
        [doneStory.ref],
      );
      await client.query(`update code_items set priority = 2000 where ref = $1`, [otherStory.ref]);
      await client.query(`update code_items set priority = 3000 where ref = $1`, [openStory.ref]);

      const fresh = await createStory(client, 'fresh dun story', projectDun, epicDun);
      const freshPriority = await priorityOf(client, fresh.ref);

      if (!(freshPriority < 3000))
        throw new Error(
          `new story (${String(freshPriority)}) not above its project's top OUTSTANDING story (3000)`,
        );
      if (!(freshPriority > 2000))
        throw new Error(
          `new story (${String(freshPriority)}) leapfrogged the other project (2000) — the ` +
            `completed story at 1000 was wrongly treated as the project top`,
        );

      return `done=1000 (ignored), other project=2000, project top outstanding=3000, new=${String(freshPriority)}`;
    },
  );

  const outstandingProjectMoveResult = await attempt(
    'move_code_priority_in_project bumps above the project’s top OUTSTANDING story, ignoring a ' +
      'completed story ranked better (ALF-120)',
    async () => {
      // Same shape as the creation check, for the double-chevron "bump to top of project". BOR
      // holds a DONE story ranked best (11000) plus two outstanding stories (13000, 14000); QUX
      // (another project) has an outstanding story at 12000, between the done story and BOR's
      // outstanding top. Bumping BOR's 14000 story to the top of its project must land it above
      // BOR's top OUTSTANDING peer (13000) yet stay behind QUX's 12000 and the hidden done story —
      // the ALF-120 bug counted the done story as the project top and sent it near the global top.
      // (High, distinct ranks so they never collide with the rows the creation check left behind —
      // the integration suite shares one connection's DB state across checks.)
      const projectBor = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const epicBor = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const projectQux = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      const epicQux = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      await client.query(
        `insert into projects (id, key, name, repo_owner, repo_name)
           values ($1, 'BOR', 'Borges', 'ac3charland', 'borges'),
                  ($2, 'QUX', 'Quux', 'ac3charland', 'quux')`,
        [projectBor, projectQux],
      );
      await client.query(
        `insert into epics (id, project_id, name, ref_number, ref)
           values ($1, $2, 'Bor Epic', 1, 'BOR-1'), ($3, $4, 'Qux Epic', 1, 'QUX-1')`,
        [epicBor, projectBor, epicQux, projectQux],
      );

      const doneStory = await createStory(client, 'completed bor story', projectBor, epicBor);
      const openTop = await createStory(client, 'outstanding bor top', projectBor, epicBor);
      const openLow = await createStory(client, 'outstanding bor low', projectBor, epicBor);
      const otherStory = await createStory(client, 'quux story', projectQux, epicQux);
      await client.query(
        `update code_items set priority = 11000, factory_state = 'done' where ref = $1`,
        [doneStory.ref],
      );
      await client.query(`update code_items set priority = 12000 where ref = $1`, [otherStory.ref]);
      await client.query(`update code_items set priority = 13000 where ref = $1`, [openTop.ref]);
      await client.query(`update code_items set priority = 14000 where ref = $1`, [openLow.ref]);

      await asRole(client, 'authenticated', () =>
        client.query(`select move_code_priority_in_project($1, $2)`, [openLow.ref, true]),
      );
      const moved = await priorityOf(client, openLow.ref);

      if (!(moved < 13_000))
        throw new Error(
          `bumped story (${String(moved)}) not above its project's top OUTSTANDING peer (13000)`,
        );
      if (!(moved > 12_000))
        throw new Error(
          `bumped story (${String(moved)}) crossed the other project (12000) — the completed ` +
            `story at 11000 was wrongly treated as the project top`,
        );

      return `done=11000 (ignored), other project=12000, top outstanding peer=13000, was 14000 → now ${String(moved)}`;
    },
  );

  const taskItemsColumnsResult = await attempt(
    'task_items view surfaces late-added items columns (priority, recurrence) (0011)',
    async () => {
      // A `select *` view freezes its column list at CREATE time, so columns added to `items`
      // after the view (recurrence in 0006, priority in 0010) stay invisible until it's recreated.
      // getAllItems() reads this view, so a dropped `priority` becomes `undefined` on every task and
      // crashes the By-Priority/folder/inbox lists. Round-trip a set value to prove the view carries it.
      const inserted = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, priority, recurrence)
             values ('prioritised task', 'task', 'high', '{"freq":"daily"}'::jsonb)
           returning id`,
        ),
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('item insert returned no id');
      const { rows } = await asRole(client, 'authenticated', () =>
        client.query<{ priority: string | null; recurrence: unknown }>(
          `select priority, recurrence from task_items where id = $1`,
          [id],
        ),
      );
      const row = rows[0];
      if (!row) throw new Error('task_items did not return the inserted row');
      if (row.priority !== 'high')
        throw new Error(`priority not surfaced by the view (got ${String(row.priority)})`);
      if (row.recurrence === null || row.recurrence === undefined)
        throw new Error('recurrence not surfaced by the view');
      return `priority=${row.priority}, recurrence carried`;
    },
  );

  const intendedProjectResult = await attempt(
    'items.intended_project_id: code-only CHECK, task_items surfacing, on-delete-set-null (ALF-62)',
    async () => {
      // The CHECK (intended_project_id is null or item_type = 'code') must reject a non-code item.
      let rejected = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(
            `insert into items (title, item_type, intended_project_id) values ('bad', 'task', $1)`,
            [PROJECT],
          ),
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('a non-code item was allowed to carry an intended project');

      // A code inbox item may carry it, and the task_items view (select i.*) must surface the
      // column — recreated in the migration so the late-added column isn't frozen out (see 0011).
      const inserted = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, intended_project_id)
             values ('project hint', 'code', $1) returning id`,
          [PROJECT],
        ),
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('code item insert returned no id');
      const surfaced = await asRole(client, 'authenticated', () =>
        client.query<{ intended_project_id: string | null }>(
          `select intended_project_id from task_items where id = $1`,
          [id],
        ),
      );
      if (surfaced.rows[0]?.intended_project_id !== PROJECT)
        throw new Error(
          `task_items did not surface intended_project_id (got ${String(surfaced.rows[0]?.intended_project_id)})`,
        );

      // on delete set null: deleting the assigned project clears the hint but keeps the row. Use a
      // throwaway project so the shared seed PROJECT (its code stories) is untouched.
      const tempProject = '33333333-3333-3333-3333-333333333333';
      await client.query(
        `insert into projects (id, key, name, repo_owner, repo_name)
           values ($1, 'TMP', 'Temp', 'ac3charland', 'temp')`,
        [tempProject],
      );
      const tempItem = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, intended_project_id)
             values ('temp hint', 'code', $1) returning id`,
          [tempProject],
        ),
      );
      const tempItemId = tempItem.rows[0]?.id;
      if (!tempItemId) throw new Error('temp code item insert returned no id');
      await client.query(`delete from projects where id = $1`, [tempProject]);
      const afterDelete = await asRole(client, 'authenticated', () =>
        client.query<{ intended_project_id: string | null }>(
          `select intended_project_id from items where id = $1`,
          [tempItemId],
        ),
      );
      if (afterDelete.rows.length !== 1)
        throw new Error('deleting the project deleted the inbox row (should only null the hint)');
      if (afterDelete.rows[0]?.intended_project_id !== null)
        throw new Error('intended_project_id was not nulled when the project was deleted');

      return 'CHECK enforced, view surfaces the column, on-delete nulls the hint';
    },
  );

  const intendedEpicResult = await attempt(
    'items.intended_epic_id: code-only CHECK, project-coherence trigger, delete cascades (ALF-170)',
    async () => {
      // The CHECK (intended_epic_id is null or item_type = 'code') must reject a non-code item —
      // a task and an unclassified row alike.
      for (const itemType of ['task', 'unclassified'] as const) {
        let rejected = false;
        try {
          await asRole(client, 'authenticated', () =>
            client.query(
              `insert into items (title, item_type, intended_epic_id) values ('bad', $1, $2)`,
              [itemType, EPIC],
            ),
          );
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error(`a ${itemType} item was allowed to carry an intended epic`);
      }

      // The coherence trigger: an epic hint with NO project hint is rejected on insert…
      let rejected = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(
            `insert into items (title, item_type, intended_epic_id) values ('bad', 'code', $1)`,
            [EPIC],
          ),
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('an epic hint with no project hint was allowed');

      // …an epic from ANOTHER project is rejected on insert…
      rejected = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(
            `insert into items (title, item_type, intended_project_id, intended_epic_id)
               values ('bad', 'code', $1, $2)`,
            [PROJECT, EPIC_2],
          ),
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('an epic from another project was allowed on insert');

      // …and a matching pair is permitted, with the view (recreated in 0027) surfacing it.
      const inserted = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, intended_project_id, intended_epic_id)
             values ('epic hint', 'code', $1, $2) returning id`,
          [PROJECT, EPIC],
        ),
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('a coherent project+epic pair was rejected');
      const surfaced = await asRole(client, 'authenticated', () =>
        client.query<{ intended_epic_id: string | null }>(
          `select intended_epic_id from task_items where id = $1`,
          [id],
        ),
      );
      if (surfaced.rows[0]?.intended_epic_id !== EPIC)
        throw new Error(
          `task_items did not surface intended_epic_id (got ${String(surfaced.rows[0]?.intended_epic_id)})`,
        );

      // The trigger also fires on UPDATE — moving the project out from under the epic raises.
      rejected = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(`update items set intended_project_id = $1 where id = $2`, [PROJECT_2, id]),
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('an update breaking project/epic coherence was allowed');

      // on delete set null: deleting the epic clears the epic hint, keeps the project hint and
      // the row. A throwaway epic so the shared seed EPIC's stories are untouched.
      const temporaryEpic = '77777777-7777-7777-7777-777777777777';
      await client.query(
        `insert into epics (id, project_id, name, ref_number, ref)
           values ($1, $2, 'Temp Epic', 999, 'ALF-999')`,
        [temporaryEpic, PROJECT],
      );
      const tempItem = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, intended_project_id, intended_epic_id)
             values ('temp epic hint', 'code', $1, $2) returning id`,
          [PROJECT, temporaryEpic],
        ),
      );
      const tempItemId = tempItem.rows[0]?.id;
      if (!tempItemId) throw new Error('temp code item insert returned no id');
      await client.query(`delete from epics where id = $1`, [temporaryEpic]);
      const afterEpicDelete = await asRole(client, 'authenticated', () =>
        client.query<{ intended_project_id: string | null; intended_epic_id: string | null }>(
          `select intended_project_id, intended_epic_id from items where id = $1`,
          [tempItemId],
        ),
      );
      const epicDeleteRow = afterEpicDelete.rows[0];
      if (epicDeleteRow?.intended_epic_id !== null)
        throw new Error('intended_epic_id was not nulled when the epic was deleted');
      if (epicDeleteRow.intended_project_id !== PROJECT)
        throw new Error('deleting the epic should leave the project hint intact');

      // Deleting the PROJECT nulls both hints: the epics cascade away (nulling the epic hint via
      // this FK) and the project FK nulls its own. A throwaway project + epic + item.
      const temporaryProject = '88888888-8888-8888-8888-888888888888';
      await client.query(
        `insert into projects (id, key, name, repo_owner, repo_name)
           values ($1, 'TPE', 'Temp For Epic', 'ac3charland', 'temp-epic')`,
        [temporaryProject],
      );
      const temporaryProjectEpic = '99999999-9999-9999-9999-999999999999';
      await client.query(
        `insert into epics (id, project_id, name, ref_number, ref)
           values ($1, $2, 'Temp Project Epic', 1, 'TPE-1')`,
        [temporaryProjectEpic, temporaryProject],
      );
      const pairItem = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, intended_project_id, intended_epic_id)
             values ('both hints', 'code', $1, $2) returning id`,
          [temporaryProject, temporaryProjectEpic],
        ),
      );
      const pairItemId = pairItem.rows[0]?.id;
      if (!pairItemId) throw new Error('paired code item insert returned no id');
      await client.query(`delete from projects where id = $1`, [temporaryProject]);
      const afterProjectDelete = await asRole(client, 'authenticated', () =>
        client.query<{ intended_project_id: string | null; intended_epic_id: string | null }>(
          `select intended_project_id, intended_epic_id from items where id = $1`,
          [pairItemId],
        ),
      );
      const projectDeleteRow = afterProjectDelete.rows[0];
      if (
        projectDeleteRow?.intended_project_id !== null ||
        projectDeleteRow.intended_epic_id !== null
      )
        throw new Error('deleting the project did not null both hints');

      return 'CHECK + trigger enforced on insert and update, view surfaces the column, deletes null the hints';
    },
  );

  const subtaskShapeResult = await attempt(
    'enforce_subtask_shape: 1-deep code children, no family mixing (ALF-129)',
    async () => {
      // A code root with one code child — the legal epic-under-construction shape.
      const codeParent = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type) values ('shape parent', 'code') returning id`,
        ),
      );
      const codeParentId = codeParent.rows[0]?.id;
      if (!codeParentId) throw new Error('code parent insert returned no id');
      const codeChild = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, parent_id)
             values ('shape child', 'code', $1) returning id`,
          [codeParentId],
        ),
      );
      const codeChildId = codeChild.rows[0]?.id;
      if (!codeChildId) throw new Error('legal code child was rejected');

      const taskParent = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type) values ('shape task', 'task') returning id`,
        ),
      );
      const taskParentId = taskParent.rows[0]?.id;
      if (!taskParentId) throw new Error('task insert returned no id');

      const mustReject = async (label: string, sql: string, params: unknown[]) => {
        let rejected = false;
        try {
          await asRole(client, 'authenticated', () => client.query(sql, params));
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error(`${label} was NOT rejected`);
      };
      await mustReject(
        'a code child under a task parent',
        `insert into items (title, item_type, parent_id) values ('bad', 'code', $1)`,
        [taskParentId],
      );
      await mustReject(
        'a task child under a code parent',
        `insert into items (title, item_type, parent_id) values ('bad', 'task', $1)`,
        [codeParentId],
      );
      await mustReject(
        'a code child two levels deep',
        `insert into items (title, item_type, parent_id) values ('bad', 'code', $1)`,
        [codeChildId],
      );
      await mustReject(
        'nesting a code parent that has children',
        `update items set parent_id = $1 where id = $2`,
        [codeChildId, codeParentId],
      );
      // Clean up so later conversions aren't entangled with this fixture.
      await client.query(`delete from items where id = any($1)`, [[codeParentId, taskParentId]]);
      return 'legal 1-deep code child allowed; all four illegal shapes rejected';
    },
  );

  const convertToEpicResult = await attempt(
    'convert_to_code_epic: parent becomes the epic, children become top-of-project stories in display order (ALF-129)',
    async () => {
      // A code parent with three children in manual order, plus the project's current top
      // outstanding story (from earlier checks) that the group must land above.
      const topBefore = await client.query<{ priority: string }>(
        `select min(priority) as priority from code_items
          where project_id = $1 and factory_state not in ('done', 'abandoned')`,
        [PROJECT],
      );
      const projectTopBefore = Number(topBefore.rows[0]?.priority);
      const parent = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, notes, item_type)
             values ('Construction inbox', 'epic notes', 'code') returning id`,
        ),
      );
      const parentId = parent.rows[0]?.id;
      if (!parentId) throw new Error('parent insert returned no id');
      for (const [index, title] of ['S1', 'S2', 'S3'].entries()) {
        await asRole(client, 'authenticated', () =>
          client.query(
            `insert into items (title, item_type, parent_id, sort_order)
               values ($1, 'code', $2, $3)`,
            [title, parentId, index + 1],
          ),
        );
      }
      const { rows } = await asRole(client, 'authenticated', () =>
        client.query<{ result: { epic: { name: string; notes: string }; stories: unknown[] } }>(
          `select convert_to_code_epic($1, $2) as result`,
          [parentId, PROJECT],
        ),
      );
      const result = rows[0]?.result;
      if (!result) throw new Error('convert_to_code_epic returned no result');
      if (result.epic.name !== 'Construction inbox' || result.epic.notes !== 'epic notes')
        throw new Error(
          `epic did not take the parent's title+notes (${JSON.stringify(result.epic)})`,
        );
      if (result.stories.length !== 3)
        throw new Error(`expected 3 stories, got ${String(result.stories.length)}`);

      // Display order === priority order, all above the project's previous top story.
      const ordered = await client.query<{ title: string; priority: string }>(
        `select i.title, c.priority from code_items c join items i on i.id = c.item_id
          where i.title = any($1) order by c.priority`,
        [['S1', 'S2', 'S3']],
      );
      const titles = ordered.rows.map((r) => r.title);
      if (JSON.stringify(titles) !== JSON.stringify(['S1', 'S2', 'S3']))
        throw new Error(`priority order is ${titles.join(',')}, expected S1,S2,S3`);
      const worstNew = Math.max(...ordered.rows.map((r) => Number(r.priority)));
      if (!(worstNew < projectTopBefore))
        throw new Error(
          `group did not land above the project's top (worst=${String(worstNew)}, top before=${String(projectTopBefore)})`,
        );

      // The code parent is deleted; the children have left task_items (they carry sidecars).
      const parentRows = await client.query(`select 1 from items where id = $1`, [parentId]);
      if (parentRows.rows.length > 0) throw new Error('code parent row was not deleted');
      const inTaskItems = await asRole(client, 'authenticated', () =>
        client.query(`select 1 from task_items where title = any($1)`, [['S1', 'S2', 'S3']]),
      );
      if (inTaskItems.rows.length > 0) throw new Error('children still visible in task_items');
      return `epic carries title+notes; priorities S1<S2<S3, all above ${String(projectTopBefore)}; parent deleted`;
    },
  );

  const convertTaskParentResult = await attempt(
    'convert_to_code_epic: a task parent completes, keeping its completed children (ALF-129)',
    async () => {
      const parent = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type) values ('Decomposed task', 'task') returning id`,
        ),
      );
      const parentId = parent.rows[0]?.id;
      if (!parentId) throw new Error('parent insert returned no id');
      await asRole(client, 'authenticated', () =>
        client.query(
          `insert into items (title, item_type, parent_id, sort_order) values ('T1', 'task', $1, 1)`,
          [parentId],
        ),
      );
      await asRole(client, 'authenticated', () =>
        client.query(
          `insert into items (title, item_type, parent_id, sort_order, status, completed_at)
             values ('Done sub', 'task', $1, 2, 'completed', now())`,
          [parentId],
        ),
      );
      await asRole(client, 'authenticated', () =>
        client.query(`select convert_to_code_epic($1, $2)`, [parentId, PROJECT]),
      );
      const after = await client.query<{ title: string; status: string; parent_id: string | null }>(
        `select title, status, parent_id from items where id = $1 or parent_id = $1`,
        [parentId],
      );
      const parentRow = after.rows.find((r) => r.title === 'Decomposed task');
      const doneChild = after.rows.find((r) => r.title === 'Done sub');
      if (parentRow?.status !== 'completed') throw new Error('task parent was not completed');
      if (doneChild?.parent_id !== parentId)
        throw new Error('completed child did not stay beneath the completed parent');
      const t1 = await client.query<{ count: string }>(
        `select count(*)::text as count from code_items c join items i on i.id = c.item_id
          where i.title = 'T1'`,
      );
      if (t1.rows[0]?.count !== '1') throw new Error('active child T1 did not become a story');
      return 'parent completed, completed child kept beneath it, active child converted';
    },
  );

  const codeStoryListReadResult = await attempt(
    'authenticated can select from v_code_stories — the GET /api/code list read (ALF-124)',
    async () => {
      // The exact read the Code view hits: `select * from v_code_stories` as the browser's
      // `authenticated` role. `v_code_stories` is `security_invoker`, so it runs as the caller and
      // needs a table GRANT — but `drop view` (0014, to widen `priority`) also dropped the select
      // grant 0002 gave it, and 0014 recreated the view with `create view` (not `create or replace`,
      // which would preserve grants) without re-granting. The result: `permission denied for view
      // v_code_stories` → PostgrestError 42501 → the route's `mapSupabaseError` returns 500, so the
      // Code view 500'd on every device. Earlier checks already seeded stories, so a working grant
      // must return rows here.
      const total = await client.query<{ count: string }>(
        `select count(*)::text as count from v_code_stories`,
      );
      if ((total.rows[0]?.count ?? '0') === '0')
        throw new Error('precondition failed: no code stories seeded to read');
      const rows = await asRole(client, 'authenticated', () =>
        client.query<{ ref: string }>(`select ref from v_code_stories order by ref_number`),
      );
      if (rows.rows.length === 0)
        throw new Error('authenticated saw zero rows — select grant on v_code_stories is missing');
      return `authenticated read ${String(rows.rows.length)} stories from v_code_stories`;
    },
  );

  const epicSpecColumnsResult = await attempt(
    'epics carries the four nullable epic-spec columns the Worker writes (ALF-130)',
    async () => {
      const { rows } = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_name = 'epics'
            and column_name in ('spec_path', 'spec_sha', 'spec_markdown', 'refinement_pr_url')
          order by column_name`,
      );
      const missing = ['refinement_pr_url', 'spec_markdown', 'spec_path', 'spec_sha'].filter(
        (name) => !rows.some((row) => row.column_name === name),
      );
      if (missing.length > 0) throw new Error(`epics is missing ${missing.join(', ')}`);
      // Every existing epic pre-dates the columns, so a NOT NULL one would have failed the
      // migration outright — and the browser never writes them, only the Worker does.
      const required = rows
        .filter((row) => row.is_nullable !== 'YES')
        .map((row) => row.column_name);
      if (required.length > 0)
        throw new Error(`epic-spec columns must be nullable: ${required.join(', ')}`);
      return 'spec_path, spec_sha, spec_markdown, refinement_pr_url all present and nullable';
    },
  );

  const epicSpecViewResult = await attempt(
    'v_code_stories exposes epic_spec_path to authenticated (the 0017 grant regression class)',
    async () => {
      // 0020 re-declared the view to append `epic_spec_path`. `create or replace` preserves the
      // SELECT grant; a drop/create would silently drop it and 500 the whole Code view (ALF-124).
      // Assert BOTH: the column is there AND authenticated can still read the view through it.
      const epic = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      await client.query(
        `insert into epics (id, project_id, name, ref_number, ref, spec_path)
           values ($1, $2, 'Spec-carrying epic', 130, 'ALF-130', 'docs/specs/epics/ALF-130.html')`,
        [epic, PROJECT],
      );
      const { ref } = await createStory(client, 'story under a specced epic', PROJECT, epic);
      const rows = await asRole(client, 'authenticated', () =>
        client.query<{ epic_spec_path: string | null }>(
          `select epic_spec_path from v_code_stories where ref = $1`,
          [ref],
        ),
      );
      const path = rows.rows[0]?.epic_spec_path;
      if (path !== 'docs/specs/epics/ALF-130.html')
        throw new Error(`authenticated read epic_spec_path as ${String(path)}`);
      return `authenticated read epic_spec_path=${path} through v_code_stories`;
    },
  );

  const requiresRefinementResult = await attempt(
    'create_code_story keeps ONE signature after 0025 and honours p_requires_refinement (ALF-137)',
    async () => {
      // 0025 had to DROP the 4-arg signature before creating the 5-arg one. Adding a defaulted
      // parameter instead would leave TWO candidate functions, and PostgREST's existing
      // 4-named-arg call would match both — `function ... is not unique`, story creation 500s.
      const { rows: signatures } = await client.query<{ count: string }>(
        `select count(*)::text as count from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_code_story'`,
      );
      const count = signatures[0]?.count ?? '0';
      if (count !== '1') throw new Error(`expected exactly 1 create_code_story, found ${count}`);

      // The 4-named-arg call PostgREST already makes still resolves…
      const legacy = await asRole(client, 'authenticated', () =>
        client.query<{ factory_state: string; requires_refinement: boolean }>(
          `select factory_state::text, requires_refinement
             from create_code_story(p_project := $1, p_epic := $2, p_title := $3, p_notes := null)`,
          [PROJECT, EPIC, 'four-named-args still resolves'],
        ),
      );
      const legacyRow = legacy.rows[0];
      if (legacyRow?.factory_state !== 'needs_refinement' || !legacyRow.requires_refinement)
        throw new Error(`4-arg call landed at ${String(legacyRow?.factory_state)}`);

      // …and clearing the flag lands the story straight in ready_for_dev.
      const marked = await asRole(client, 'authenticated', () =>
        client.query<{ factory_state: string; requires_refinement: boolean }>(
          `select factory_state::text, requires_refinement
             from create_code_story(p_project := $1, p_epic := $2, p_title := $3,
                                    p_requires_refinement := false)`,
          [PROJECT, EPIC, 'no spec needed'],
        ),
      );
      const markedRow = marked.rows[0];
      if (markedRow?.factory_state !== 'ready_for_dev' || markedRow.requires_refinement)
        throw new Error(
          `p_requires_refinement := false landed at ${String(markedRow?.factory_state)}`,
        );
      return `1 signature; 4-arg → needs_refinement, flag cleared → ready_for_dev`;
    },
  );

  const epicRealtimeResult = await attempt(
    'epics is in the supabase_realtime publication so a snapshot reaches an open board',
    async () => {
      const { rows } = await client.query<{ tablename: string }>(
        `select tablename from pg_publication_tables
          where pubname = 'supabase_realtime' and tablename = 'epics'`,
      );
      if (rows.length === 0) throw new Error('epics is not published to supabase_realtime');
      return 'epics published to supabase_realtime';
    },
  );

  const habitSchemaResult = await attempt(
    'habits: the check constraints reject an empty criteria list, a bad weekday, and an over-large allowance (ALF-147)',
    async () => {
      const rejected: string[] = [];
      const cases: [string, string][] = [
        ['habits_criteria_non_empty', `'[]'::jsonb, '{1,2,3,4,5,6,7}', 0`],
        ['habits_criteria_non_empty', `'{"key":"k"}'::jsonb, '{1,2,3,4,5,6,7}', 0`],
        ['habits_active_days_valid', `'[{"key":"k"}]'::jsonb, '{0,1}', 0`],
        ['habits_active_days_valid', `'[{"key":"k"}]'::jsonb, '{}', 0`],
        ['habits_allowance_range', `'[{"key":"k"}]'::jsonb, '{1,2,3}', 8`],
      ];
      for (const [name, values] of cases) {
        try {
          await client.query(
            `insert into habits (name, criteria, active_days, allowance) values ('bad', ${values})`,
          );
        } catch {
          rejected.push(name);
          continue;
        }
        throw new Error(`${name} accepted a row it should reject (${values})`);
      }
      return `rejected: ${rejected.join(', ')}`;
    },
  );

  const habitEntryUniqueResult = await attempt(
    'habit_entries: one row per (habit_id, entry_date), which is what makes logging an upsert (ALF-147)',
    async () => {
      const habit = 'aaaaaaaa-0000-4000-8000-000000000001';
      await client.query(
        `insert into habits (id, name, criteria) values ($1, 'Morning routine', '[{"key":"light"}]'::jsonb)`,
        [habit],
      );
      await client.query(
        `insert into habit_entries (habit_id, entry_date, status) values ($1, '2026-07-27', 'met')`,
        [habit],
      );
      let denied = false;
      try {
        await client.query(
          `insert into habit_entries (habit_id, entry_date, status) values ($1, '2026-07-27', 'missed')`,
          [habit],
        );
      } catch {
        denied = true;
      }
      if (!denied) throw new Error('a duplicate (habit_id, entry_date) was accepted');
      // The same write as an upsert is the correction path, and it must land on the one row.
      await client.query(
        `insert into habit_entries (habit_id, entry_date, status) values ($1, '2026-07-27', 'missed')
           on conflict (habit_id, entry_date) do update set status = excluded.status`,
        [habit],
      );
      const { rows } = await client.query<{ count: string; status: string }>(
        `select count(*)::text as count, max(status::text) as status
           from habit_entries where habit_id = $1`,
        [habit],
      );
      const settled = rows[0];
      if (settled?.count !== '1') {
        throw new Error(`upsert left ${settled?.count ?? 'no'} rows`);
      }
      return `duplicate rejected; upsert left 1 row at status=${settled.status}`;
    },
  );

  const habitCascadeResult = await attempt(
    'habit_entries: deleting a habit takes its logged days with it (ALF-147)',
    async () => {
      const habit = 'aaaaaaaa-0000-4000-8000-000000000002';
      await client.query(
        `insert into habits (id, name, criteria) values ($1, 'Doomed', '[{"key":"light"}]'::jsonb)`,
        [habit],
      );
      await client.query(
        `insert into habit_entries (habit_id, entry_date, status) values ($1, '2026-07-27', 'met')`,
        [habit],
      );
      await client.query(`delete from habits where id = $1`, [habit]);
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from habit_entries where habit_id = $1`,
        [habit],
      );
      if (rows[0]?.count !== '0') throw new Error(`${rows[0]?.count ?? '?'} orphaned entries left`);
      return 'entries cascaded with the habit';
    },
  );

  const habitGrantsResult = await attempt(
    'habits + habit_entries: the authenticated role can read and write both tables (the 0008/0017 grant class)',
    async () => {
      const habit = 'aaaaaaaa-0000-4000-8000-000000000003';
      return asRole(client, 'authenticated', async () => {
        await client.query(
          `insert into habits (id, name, criteria) values ($1, 'As authenticated', '[{"key":"light"}]'::jsonb)`,
          [habit],
        );
        await client.query(
          `insert into habit_entries (habit_id, entry_date, status, results)
             values ($1, '2026-07-27', 'met', '{"light":true}'::jsonb)`,
          [habit],
        );
        const { rows } = await client.query<{ status: string }>(
          `select status::text as status from habit_entries where habit_id = $1`,
          [habit],
        );
        if (rows[0]?.status !== 'met')
          throw new Error('authenticated could not read its own write');
        return 'authenticated inserted and read back both tables';
      });
    },
  );

  const folderSortOrderResult = await attempt(
    'folders: authenticated can create one (the sequence-default grant class of 0008) and reorder it to a midpoint rank (ALF-153)',
    async () => {
      return asRole(client, 'authenticated', async () => {
        // No explicit sort_order: the column default calls nextval(), which needs USAGE on the
        // sequence as `authenticated` — the exact grant 0008 was written to fix.
        const inserted = await client.query<{ id: string; sort_order: string }>(
          `insert into folders (name) values ('Work'), ('Home')
             returning id, sort_order::text as sort_order`,
        );
        const [first, second] = inserted.rows;
        if (first === undefined || second === undefined)
          throw new Error('expected two folders back');
        if (Number(first.sort_order) >= Number(second.sort_order))
          throw new Error('a fresh folder must append below the previous one');

        // A reorder is one UPDATE to a fractional rank — no neighbour is renumbered.
        const midpoint = (Number(first.sort_order) + Number(second.sort_order)) / 2;
        await client.query(`update folders set sort_order = $1 where id = $2`, [
          midpoint,
          second.id,
        ]);
        const { rows } = await client.query<{ name: string }>(
          `select name from folders order by sort_order asc`,
        );
        const order = rows.map((row) => row.name).join(' → ');
        if (order !== 'Work → Home')
          throw new Error(`expected the midpoint rank to leave Home below Work, got ${order}`);
        return `authenticated inserted ranks ${first.sort_order}, ${second.sort_order}; midpoint ${String(midpoint)} keeps ${order}`;
      });
    },
  );

  const entityDescriptionResult = await attempt(
    'folders and projects carry a nullable description capped at 500 chars (ALF-179)',
    async () => {
      const { rows } = await client.query<{ table_name: string; is_nullable: string }>(
        `select table_name, is_nullable from information_schema.columns
          where table_name in ('folders', 'projects') and column_name = 'description'
          order by table_name`,
      );
      const missing = ['folders', 'projects'].filter(
        (name) => !rows.some((row) => row.table_name === name),
      );
      if (missing.length > 0)
        throw new Error(`missing description column on ${missing.join(', ')}`);
      // Every row pre-dates the column, so NOT NULL would have failed the migration outright —
      // and "undescribed" stays a legal state forever, not just until the first save.
      const required = rows.filter((row) => row.is_nullable !== 'YES').map((row) => row.table_name);
      if (required.length > 0)
        throw new Error(`description must be nullable on ${required.join(', ')}`);

      // The cap is the backstop under the zod `.max(500)`: the DB refuses an essay even if a
      // caller reaches the table without passing through the route.
      const tooLong = 'x'.repeat(501);
      const rejected: string[] = [];
      for (const [table, insert] of [
        ['folders', `insert into folders (name, description) values ('Capped', $1)`],
        [
          'projects',
          `insert into projects (key, name, repo_owner, repo_name, description)
             values ('CAP', 'Capped', 'ac3charland', 'alfred', $1)`,
        ],
      ] as const) {
        try {
          await client.query(insert, [tooLong]);
        } catch {
          rejected.push(table);
        }
      }
      const accepted = ['folders', 'projects'].filter((table) => !rejected.includes(table));
      if (accepted.length > 0)
        throw new Error(`${accepted.join(', ')} accepted a 501-character description`);
      return 'both columns nullable; both CHECKs rejected 501 characters';
    },
  );

  const habitAnonResult = await attempt(
    'anon sees zero habits despite rows existing (RLS read)',
    async () => {
      const total = await client.query<{ count: string }>(
        `select count(*)::text as count from habits`,
      );
      const visible = await asRole(client, 'anon', () =>
        client.query<{ count: string }>(`select count(*)::text as count from habits`),
      );
      if (total.rows[0]?.count === '0')
        throw new Error('precondition failed: no habits to test RLS against');
      if (visible.rows[0]?.count !== '0')
        throw new Error(`anon saw ${visible.rows[0]?.count ?? '?'} habits; RLS should hide all`);
      return `admin sees ${total.rows[0]?.count ?? '?'}, anon sees 0`;
    },
  );

  const anonInsertResult = await attempt('anon cannot insert (RLS write denial)', async () => {
    let denied = false;
    try {
      await asRole(client, 'anon', () => client.query(`insert into items (title) values ('nope')`));
    } catch {
      denied = true;
    }
    if (!denied) throw new Error('anon insert was NOT denied');
    return 'anon insert rejected by RLS';
  });

  const anonReadResult = await attempt(
    'anon sees zero code_items rows despite rows existing (RLS read)',
    async () => {
      const total = await client.query<{ count: string }>(
        `select count(*)::text as count from code_items`,
      );
      const visible = await asRole(client, 'anon', () =>
        client.query<{ count: string }>(`select count(*)::text as count from code_items`),
      );
      const totalCount = total.rows[0]?.count ?? '0';
      const anonCount = visible.rows[0]?.count ?? '0';
      if (totalCount === '0')
        throw new Error('precondition failed: no code_items to test RLS against');
      if (anonCount !== '0') throw new Error(`anon saw ${anonCount} rows; RLS should hide all`);
      return `admin sees ${totalCount}, anon sees ${anonCount}`;
    },
  );

  const dispatchBackfillResult = await attempt(
    'the dispatch backfill leaves every foldered item dispatched and every other item in the Inbox (ALF-168)',
    async () => {
      const rows = await replayDispatchBackfill(client);
      const expected = [
        { title: 'filed subtask', dispatched: true },
        { title: 'filed task', dispatched: true },
        { title: 'inbox capture', dispatched: false },
      ];
      const actual = rows.map((row) => `${row.title}=${String(row.dispatched)}`).join(', ');
      const wanted = expected.map((row) => `${row.title}=${String(row.dispatched)}`).join(', ');
      if (actual !== wanted) throw new Error(`expected ${wanted}, got ${actual}`);
      return `pre-existing rows after the migration: ${actual}`;
    },
  );

  const dispatchInheritanceResult = await attempt(
    'a new item inherits residency from its parent, else from its folder (ALF-168)',
    async () => {
      const { rows: folderRows } = await client.query<{ id: string }>(
        `insert into folders (name) values ('Inheritance') returning id`,
      );
      const folder = folderRows[0]?.id;
      if (folder === undefined) throw new Error('could not seed a folder');

      const insert = async (
        columns: string,
        values: readonly unknown[],
      ): Promise<{ id: string; dispatched_at: string | null }> => {
        const placeholders = values.map((_, index) => `$${String(index + 1)}`).join(', ');
        // `::text`, so two rows' residency compares by VALUE — `pg` parses timestamptz into a
        // Date, and two equal instants are two different objects under `!==`.
        const { rows } = await client.query<{ id: string; dispatched_at: string | null }>(
          `insert into items (${columns}) values (${placeholders})
             returning id, dispatched_at::text as dispatched_at`,
          [...values],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('insert returned no row');
        return row;
      };

      const filed = await insert('title, item_type, folder_id', ['filed', 'task', folder]);
      if (filed.dispatched_at === null)
        throw new Error('an item created with a folder must be dispatched on insert');

      const captured = await insert('title, item_type', ['captured', 'task']);
      if (captured.dispatched_at !== null)
        throw new Error('a plain capture must stay in the Inbox');

      const filedChild = await insert('title, item_type, folder_id, parent_id', [
        'filed child',
        'task',
        folder,
        filed.id,
      ]);
      if (filedChild.dispatched_at !== filed.dispatched_at)
        throw new Error('a child must adopt its parent’s residency exactly, not its own now()');

      const inboxChild = await insert('title, item_type, parent_id', [
        'inbox child',
        'task',
        captured.id,
      ]);
      if (inboxChild.dispatched_at !== null)
        throw new Error('a child of an undispatched parent must stay in the Inbox');

      return 'folder → dispatched; no folder → Inbox; child adopts its parent’s residency either way';
    },
  );

  const dispatchFolderDeleteResult = await attempt(
    'deleting a folder returns its items to the Inbox — both fields (ALF-168)',
    async () => {
      const { rows: folderRows } = await client.query<{ id: string }>(
        `insert into folders (name) values ('Doomed') returning id`,
      );
      const folder = folderRows[0]?.id;
      if (folder === undefined) throw new Error('could not seed a folder');
      const { rows: itemRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type, folder_id) values ('homeless soon', 'task', $1)
           returning id`,
        [folder],
      );
      const item = itemRows[0]?.id;
      if (item === undefined) throw new Error('could not seed an item');

      await client.query(`delete from folders where id = $1`, [folder]);

      const { rows } = await client.query<{
        folder_id: string | null;
        dispatched_at: string | null;
      }>(`select folder_id, dispatched_at from items where id = $1`, [item]);
      const row = rows[0];
      if (row === undefined) throw new Error('the item was deleted along with its folder');
      if (row.folder_id !== null || row.dispatched_at !== null)
        throw new Error(
          `expected both fields null, got folder_id=${String(row.folder_id)} dispatched_at=${String(row.dispatched_at)}`,
        );
      return 'folder_id and dispatched_at both cleared — the item is back in the Inbox';
    },
  );

  const dispatchCheckResult = await attempt(
    'the database refuses a dispatched task with no folder, and accepts a dispatched code item (ALF-168)',
    async () => {
      let rejected = '';
      try {
        await client.query(
          `insert into items (title, item_type, dispatched_at) values ('nowhere', 'task', now())`,
        );
      } catch (error) {
        rejected = error instanceof Error ? error.message : String(error);
      }
      if (rejected === '')
        throw new Error('a dispatched folderless TASK was accepted — it would render nowhere');
      if (!rejected.includes('items_dispatched_needs_folder'))
        throw new Error(`rejected by the wrong constraint: ${rejected}`);

      // A code item is the deliberate exception: it leaves for the factory, which has no folders.
      const { rows } = await client.query<{ dispatched_at: string | null }>(
        `insert into items (title, item_type, dispatched_at) values ('gated', 'code', now())
           returning dispatched_at`,
      );
      if (rows[0]?.dispatched_at == undefined)
        throw new Error('a dispatched folderless CODE item should have been accepted');

      // And the shape the whole column exists for: a folder written onto an Inbox row with no
      // dispatch. The CHECK must permit it — a guess about where an item belongs is not a
      // decision to send it there, so the item stays put.
      const { rows: folderRows } = await client.query<{ id: string }>(
        `insert into folders (name) values ('Guessed') returning id`,
      );
      const { rows: guessRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type) values ('a capture', 'task') returning id`,
      );
      await client.query(`update items set folder_id = $1 where id = $2`, [
        folderRows[0]?.id,
        guessRows[0]?.id,
      ]);
      const { rows: stillInbox } = await client.query<{ in_inbox: boolean }>(
        `select dispatched_at is null as in_inbox from items where id = $1`,
        [guessRows[0]?.id],
      );
      if (stillInbox[0]?.in_inbox !== true)
        throw new Error('writing a folder onto an Inbox row must not move it out of the Inbox');

      return 'task rejected; code item accepted; a folder written onto an Inbox row leaves it there';
    },
  );

  const dispatchOnGateResult = await attempt(
    'enter_code_module and convert_to_code_epic stamp dispatched_at, and task_items surfaces it (ALF-168)',
    async () => {
      const { rows: gateRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type) values ('gate me', 'task') returning id`,
      );
      const gated = gateRows[0]?.id;
      if (gated === undefined) throw new Error('could not seed an inbox item');
      // The view-recreation guard: an items column added after `task_items` was created is
      // invisible to `select i.*` until the view is recreated (the 0011/0013 freeze).
      const { rows: viewRows } = await client.query<{ dispatched_at: string | null }>(
        `select dispatched_at from task_items where id = $1`,
        [gated],
      );
      if (viewRows.length !== 1)
        throw new Error('the seeded inbox item is missing from the task_items view');
      if (viewRows[0]?.dispatched_at !== null)
        throw new Error('a plain capture should read back undispatched through the view');

      await asRole(client, 'authenticated', () =>
        client.query(`select enter_code_module($1, $2, $3)`, [gated, PROJECT, EPIC]),
      );
      const { rows: gatedRows } = await client.query<{ dispatched_at: string | null }>(
        `select dispatched_at from items where id = $1`,
        [gated],
      );
      if (gatedRows[0]?.dispatched_at == undefined)
        throw new Error('enter_code_module left the admitted item undispatched');

      const { rows: parentRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type) values ('decomposed', 'task') returning id`,
      );
      const parent = parentRows[0]?.id;
      if (parent === undefined) throw new Error('could not seed a parent');
      const { rows: childRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type, parent_id) values ('a child', 'task', $1)
           returning id`,
        [parent],
      );
      const child = childRows[0]?.id;
      if (child === undefined) throw new Error('could not seed a child');
      await asRole(client, 'authenticated', () =>
        client.query(`select convert_to_code_epic($1, $2)`, [parent, PROJECT]),
      );
      const { rows: convertedRows } = await client.query<{ dispatched_at: string | null }>(
        `select dispatched_at from items where id = $1`,
        [child],
      );
      if (convertedRows[0]?.dispatched_at == undefined)
        throw new Error('convert_to_code_epic left the converted child undispatched');

      return 'task_items surfaces dispatched_at; both factory RPCs stamp the rows they consume';
    },
  );

  const classifierColumnsResult = await attempt(
    'items carries the classifier provenance columns and task_items surfaces them (ALF-171)',
    async () => {
      const { rows } = await client.query<{
        column_name: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `select column_name, is_nullable, column_default from information_schema.columns
          where table_name = 'items'
            and column_name in ('classified_at', 'classified_provider', 'classified_model',
                                'classified_prompt_version', 'classified_guess',
                                'classify_attempts')
          order by column_name`,
      );
      if (rows.length !== 6)
        throw new Error(`expected 6 provenance columns, found ${String(rows.length)}`);

      // Every one is nullable except the attempt counter, which must default to 0 — the sweep
      // predicate compares against it, and a null would drop every row out of `lt.5`.
      const required = rows.filter((row) => row.is_nullable !== 'YES').map((r) => r.column_name);
      if (required.join(',') !== 'classify_attempts')
        throw new Error(`unexpected non-nullable columns: ${required.join(', ') || 'none'}`);
      const attempts = rows.find((row) => row.column_name === 'classify_attempts');
      if (attempts?.column_default !== '0')
        throw new Error(`classify_attempts default is ${String(attempts?.column_default)}, not 0`);

      // The view-recreation guard (the 0011/0013/0026 freeze): a column added to items after
      // task_items was created stays invisible to `select i.*` until the view is recreated, and
      // getAllItems() reads the view with the TABLE row type.
      const { rows: viewRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type) values ('provenance probe', 'task') returning id`,
      );
      const probe = viewRows[0]?.id;
      if (probe === undefined) throw new Error('could not seed the probe item');
      const surfaced = await asRole(client, 'authenticated', () =>
        client.query<{ classified_at: string | null; classified_guess: unknown }>(
          `select classified_at, classified_guess, classify_attempts from task_items where id = $1`,
          [probe],
        ),
      );
      if (surfaced.rows.length !== 1)
        throw new Error('task_items does not surface the new provenance columns');

      return 'six columns, classify_attempts not null default 0, all readable through task_items';
    },
  );

  const classifierClaimResult = await attempt(
    'a human edit claims an unclassified item, and a referential cascade does not (ALF-171)',
    async () => {
      const insert = async (columns: string, values: readonly unknown[]): Promise<string> => {
        const placeholders = values.map((_, index) => `$${String(index + 1)}`).join(', ');
        const { rows } = await client.query<{ id: string }>(
          `insert into items (${columns}) values (${placeholders}) returning id`,
          [...values],
        );
        const id = rows[0]?.id;
        if (id === undefined) throw new Error('insert returned no id');
        return id;
      };
      const provenanceOf = async (
        id: string,
      ): Promise<{ classified_at: string | null; classified_provider: string | null }> => {
        const { rows } = await client.query<{
          classified_at: string | null;
          classified_provider: string | null;
        }>(
          `select classified_at::text as classified_at, classified_provider
             from items where id = $1`,
          [id],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('the item disappeared');
        return row;
      };

      // 1. A watched edit on a never-classified row stamps the marker — and leaves the
      //    provenance null, which is how a human claim stays distinguishable from a verdict.
      const edited = await insert('title, item_type', ['rewrite me', 'task']);
      await client.query(`update items set title = 'rewritten' where id = $1`, [edited]);
      const afterEdit = await provenanceOf(edited);
      if (afterEdit.classified_at === null)
        throw new Error('editing a watched field did not claim the item');
      if (afterEdit.classified_provider !== null)
        throw new Error('a human claim wrongly stamped a provider');

      // 2. The classifier stamping its own verdict is not double-stamped: the value it wrote
      //    survives, even though the same statement changes watched fields.
      const stamped = '2020-01-02 03:04:05+00';
      const judged = await insert('title, item_type', ['judge me', 'task']);
      await client.query(
        `update items set item_type = 'task', priority = 'high', classified_at = $2,
                          classified_provider = 'anthropic'
           where id = $1`,
        [judged, stamped],
      );
      const afterVerdict = await provenanceOf(judged);
      if (!afterVerdict.classified_at?.startsWith('2020-01-02'))
        throw new Error(
          `the classifier's own stamp was overwritten: ${String(afterVerdict.classified_at)}`,
        );

      // 3. A later human edit of an already-claimed row leaves the original marker alone, so
      //    the guess it was judged with stays paired with the timestamp that produced it.
      await client.query(`update items set title = 'edited after judging' where id = $1`, [judged]);
      const afterSecondEdit = await provenanceOf(judged);
      if (afterSecondEdit.classified_at !== afterVerdict.classified_at)
        throw new Error('editing an already-claimed row re-stamped classified_at');

      // 4. An unwatched column is not a claim — the classifier writes this one itself.
      const untouched = await insert('title, item_type', ['leave me eligible', 'task']);
      await client.query(`update items set classify_attempts = 1 where id = $1`, [untouched]);
      const unwatched = await provenanceOf(untouched);
      if (unwatched.classified_at !== null)
        throw new Error('an unwatched column change claimed the item');

      // 5. The cascade case. Deleting a folder returns its undispatched items to the Inbox
      //    (0026's trigger) AND nulls their folder_id (the FK). Neither may claim, or the rows
      //    that most need re-triaging would be permanently hidden from the sweeper.
      const { rows: folderRows } = await client.query<{ id: string }>(
        `insert into folders (name) values ('Cascade') returning id`,
      );
      const folder = folderRows[0]?.id;
      if (folder === undefined) throw new Error('could not seed a folder');
      const filed = await insert('title, item_type, folder_id', ['guessed home', 'task', folder]);
      await client.query(`update items set dispatched_at = null where id = $1`, [filed]);
      await client.query(`delete from folders where id = $1`, [folder]);
      const afterCascade = await provenanceOf(filed);
      if (afterCascade.classified_at !== null)
        throw new Error('a folder delete claimed the items it returned to the Inbox');

      return 'watched edit claims (provider null); the verdict is not double-stamped; an unwatched column and a folder-delete cascade both leave the row eligible';
    },
  );

  const classifierCorrectionsResult = await attempt(
    'dispatch diffs the stored guess against the final labels, through every exit (ALF-171)',
    async () => {
      const { rows: folderRows } = await client.query<{ id: string; name: string }>(
        `insert into folders (name) values ('Health'), ('Work') returning id, name`,
      );
      const health = folderRows.find((row) => row.name === 'Health')?.id;
      const work = folderRows.find((row) => row.name === 'Work')?.id;
      if (health === undefined || work === undefined) throw new Error('could not seed folders');

      /** Insert an item and write a classifier verdict onto it, exactly as the Worker does. */
      const classified = async (
        title: string,
        guess: Record<string, unknown>,
        write: Record<string, unknown>,
      ): Promise<string> => {
        const { rows } = await client.query<{ id: string }>(
          `insert into items (title, notes, item_type) values ($1, 'as captured', 'unclassified')
             returning id`,
          [title],
        );
        const id = rows[0]?.id;
        if (id === undefined) throw new Error('item insert returned no id');
        const columns = Object.keys(write);
        const assignments = columns
          .map((column, index) => `${column} = $${String(index + 2)}`)
          .join(', ');
        await client.query(
          `update items set ${assignments}, classified_at = now(),
                            classified_provider = 'anthropic', classified_model = 'claude-haiku-4-5',
                            classified_prompt_version = 1, classified_guess = $${String(columns.length + 2)}
             where id = $1`,
          [id, ...columns.map((column) => write[column]), JSON.stringify(guess)],
        );
        return id;
      };
      const correctionsFor = async (
        id: string,
      ): Promise<
        { field: string; direction: string; guessed: string | null; chosen: string | null }[]
      > => {
        const { rows } = await client.query<{
          field: string;
          direction: string;
          guessed: string | null;
          chosen: string | null;
        }>(
          `select field, direction, guessed_value as guessed, chosen_value as chosen
             from classification_corrections where item_id = $1 order by field`,
          [id],
        );
        return rows;
      };

      // All three directions in one dispatch: the owner re-filed it, cleared the priority, and
      // added the due date the model declined to guess. item_type agreed, so it teaches nothing.
      const mixed = await classified(
        'Call the dentist to reschedule',
        {
          item_type: 'task',
          priority: 'high',
          due_date: undefined,
          folder_id: health,
          intended_project_id: undefined,
          intended_epic_id: undefined,
        },
        { item_type: 'task', priority: 'high', folder_id: health },
      );
      await client.query(
        `update items set folder_id = $2, priority = null, due_date = '2026-08-07' where id = $1`,
        [mixed, work],
      );
      await client.query(`update items set dispatched_at = now() where id = $1`, [mixed]);

      const logged = await correctionsFor(mixed);
      const described = logged
        .map((row) => `${row.field}:${row.direction}(${row.guessed ?? '-'}→${row.chosen ?? '-'})`)
        .join(', ');
      if (logged.length !== 3)
        throw new Error(`expected 3 corrections, got ${String(logged.length)}: ${described}`);
      const byField = new Map(logged.map((row) => [row.field, row]));
      if (byField.get('folder_id')?.direction !== 'changed')
        throw new Error(`folder_id should be 'changed': ${described}`);
      if (byField.get('folder_id')?.chosen !== work)
        throw new Error(`folder_id chose the wrong folder: ${described}`);
      if (byField.get('priority')?.direction !== 'blanked')
        throw new Error(`priority should be 'blanked': ${described}`);
      if (byField.get('due_date')?.direction !== 'filled_in')
        throw new Error(`due_date should be 'filled_in': ${described}`);
      // The date is compared as the calendar day it was written as, not as a timestamp string.
      if (byField.get('due_date')?.chosen !== '2026-08-07')
        throw new Error(
          `due_date chose ${String(byField.get('due_date')?.chosen)}, not 2026-08-07`,
        );

      // Dispatching again is not a second lesson — the trigger keys on the transition.
      await client.query(`update items set dispatched_at = now() where id = $1`, [mixed]);
      const afterSecondDispatch = await correctionsFor(mixed);
      if (afterSecondDispatch.length !== 3)
        throw new Error('re-dispatching an already-dispatched item logged the diff twice');

      // Agreement is silent, and so is a row no model judged.
      const agreed = await classified(
        'Book the MOT',
        {
          item_type: 'task',
          priority: undefined,
          due_date: undefined,
          folder_id: work,
          intended_project_id: undefined,
          intended_epic_id: undefined,
        },
        { item_type: 'task', folder_id: work },
      );
      await client.query(`update items set dispatched_at = now() where id = $1`, [agreed]);
      const agreedLog = await correctionsFor(agreed);
      if (agreedLog.length > 0)
        throw new Error('a verdict the owner agreed with was logged as a correction');

      const { rows: claimedRows } = await client.query<{ id: string }>(
        `insert into items (title, item_type, folder_id, classified_at)
           values ('claimed by hand', 'task', $1, now()) returning id`,
        [work],
      );
      const claimed = claimedRows[0]?.id;
      if (claimed === undefined) throw new Error('could not seed a hand-claimed item');
      await client.query(`update items set dispatched_at = now() where id = $1`, [claimed]);
      const claimedLog = await correctionsFor(claimed);
      if (claimedLog.length > 0)
        throw new Error('an item with no stored guess produced corrections');

      // The factory RPC is a dispatch too — and its due_date null-out is the correct lesson,
      // not a special case: the owner decided this was code, so the due date was wrong.
      const gated = await classified(
        'Alfred should let me snooze an item',
        {
          item_type: 'task',
          priority: undefined,
          due_date: '2026-08-10',
          folder_id: undefined,
          intended_project_id: undefined,
          intended_epic_id: undefined,
        },
        { item_type: 'task', due_date: '2026-08-10' },
      );
      await asRole(client, 'authenticated', () =>
        client.query(`select enter_code_module($1, $2, $3)`, [gated, PROJECT, EPIC]),
      );
      const gatedLog = await correctionsFor(gated);
      const gatedDescribed = gatedLog.map((row) => `${row.field}:${row.direction}`).join(', ');
      if (gatedLog.length !== 2)
        throw new Error(`enter_code_module logged ${String(gatedLog.length)}: ${gatedDescribed}`);
      if (gatedDescribed !== 'due_date:blanked, item_type:changed')
        throw new Error(`unexpected RPC-path corrections: ${gatedDescribed}`);

      // A lesson outlives its item: the reference goes, the frozen text stays.
      const { rows: beforeDelete } = await client.query<{ captured_text: string }>(
        `select captured_text from classification_corrections where item_id = $1 limit 1`,
        [mixed],
      );
      const frozen = beforeDelete[0]?.captured_text;
      if (frozen !== 'Call the dentist to reschedule\nas captured')
        throw new Error(`captured_text froze the wrong text: ${String(frozen)}`);
      await client.query(`delete from items where id = $1`, [mixed]);
      const { rows: orphaned } = await client.query<{ count: string }>(
        `select count(*)::text as count from classification_corrections
          where item_id is null and captured_text = $1`,
        [frozen],
      );
      if (orphaned[0]?.count !== '3')
        throw new Error(`deleting the item lost its lessons (${String(orphaned[0]?.count)} left)`);

      return `three directions logged (${described}); re-dispatch, agreement and an unjudged row log nothing; enter_code_module logs ${gatedDescribed}; a deleted item leaves its lessons intact`;
    },
  );

  const correctionsGrantsResult = await attempt(
    'a browser-role dispatch can insert corrections through the trigger, and anon sees none (ALF-171)',
    async () => {
      const { rows: folderRows } = await client.query<{ id: string }>(
        `insert into folders (name) values ('Browser') returning id`,
      );
      const folder = folderRows[0]?.id;
      if (folder === undefined) throw new Error('could not seed a folder');

      // The trigger is `security invoker`, so the INSERT runs as whoever dispatched. A browser
      // dispatch is the `authenticated` role — miss the grant and every dispatch 500s.
      const guess = {
        item_type: 'task',
        priority: 'low',
        due_date: undefined,
        folder_id: folder,
        intended_project_id: undefined,
        intended_epic_id: undefined,
      };
      // Seeded WITHOUT the folder: 0026's insert trigger reads a folder as "already dispatched",
      // and a row that arrives dispatched never makes the null → non-null transition the diff
      // keys on. The classifier's folder guess is applied below, in the dispatching UPDATE.
      const inserted = await asRole(client, 'authenticated', () =>
        client.query<{ id: string }>(
          `insert into items (title, item_type, priority, classified_at, classified_provider,
                              classified_model, classified_prompt_version, classified_guess)
             values ('as the browser sees it', 'task', 'low',
                     now(), 'anthropic', 'claude-haiku-4-5', 1, $1)
             returning id`,
          [JSON.stringify(guess)],
        ),
      );
      const item = inserted.rows[0]?.id;
      if (item === undefined) throw new Error('authenticated could not seed the item');

      await asRole(client, 'authenticated', () =>
        client.query(
          `update items set folder_id = $2, priority = 'high', dispatched_at = now()
             where id = $1`,
          [item, folder],
        ),
      );
      const visible = await asRole(client, 'authenticated', () =>
        client.query<{ field: string; direction: string }>(
          `select field, direction from classification_corrections where item_id = $1`,
          [item],
        ),
      );
      if (visible.rows.length !== 1 || visible.rows[0]?.direction !== 'changed')
        throw new Error(
          `authenticated dispatch logged ${String(visible.rows.length)} correction(s), expected 1 'changed'`,
        );

      const hidden = await asRole(client, 'anon', () =>
        client.query<{ count: string }>(
          `select count(*)::text as count from classification_corrections`,
        ),
      );
      if (hidden.rows[0]?.count !== '0')
        throw new Error(
          `anon saw ${String(hidden.rows[0]?.count)} corrections; RLS should hide all`,
        );

      return 'authenticated dispatched and the trigger inserted as that role; anon sees zero rows';
    },
  );

  const itemsRealtimeResult = await attempt(
    'items is in the supabase_realtime publication so a verdict reaches an open Inbox (ALF-196)',
    async () => {
      const { rows } = await client.query<{ tablename: string }>(
        `select tablename from pg_publication_tables
          where pubname = 'supabase_realtime' and tablename = 'items'`,
      );
      if (rows.length === 0) throw new Error('items is not published to supabase_realtime');
      return 'items published to supabase_realtime';
    },
  );

  // ── Weekly-plan items (ALF-195) ─────────────────────────────────────────────
  // The two review endpoints stand on a batch RPC, a provenance column that must reach the read
  // path, and a trigger that finally records WHEN a story shipped. Each claim below is one the
  // route layer cannot make on its own.

  /** Archive a week-plan document and return its id — the cohort key the RPC stamps. */
  const seedPlan = async (html: string): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `insert into weekly_plans (html) values ($1) returning id`,
      [html],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('could not archive a weekly plan');
    return id;
  };

  const weeklyPlanBatchResult = await attempt(
    'create_weekly_plan_items writes a whole week of every type, in the Inbox, in order (ALF-195)',
    async () => {
      const plan = await seedPlan('<!doctype html><html><body>week</body></html>');
      const batch = [
        {
          item_type: 'task',
          title: 'Ship the spike',
          notes: 'Timebox to Tuesday',
          due_date: '2026-09-08',
          priority: 'high',
          children: [{ title: 'Re-read the findings' }, { title: 'Write the skeleton' }],
        },
        {
          item_type: 'code',
          title: 'Per-voice mute',
          children: [{ title: 'Mute state' }, { title: 'Mixer strip button' }],
        },
        { title: "Decide Q4's third rock" },
      ];
      const { rows } = await asRole(client, 'authenticated', () =>
        client.query<{
          id: string;
          title: string;
          item_type: string;
          parent_id: string | null;
          weekly_plan_id: string | null;
          dispatched_at: string | null;
          folder_id: string | null;
          status: string;
          created_at: string;
        }>(`select * from create_weekly_plan_items($1, $2::jsonb)`, [plan, JSON.stringify(batch)]),
      );

      // Seven nodes: three roots and four children, all returned by the one call.
      if (rows.length !== 7) throw new Error(`expected 7 rows, got ${String(rows.length)}`);
      for (const row of rows) {
        if (row.weekly_plan_id !== plan)
          throw new Error(`${row.title} carries weekly_plan_id ${String(row.weekly_plan_id)}`);
        // Untriaged, always: dispatch is a human act, and 0026's inherit trigger must not
        // separate a root from its children across two views.
        if (row.dispatched_at !== null || row.folder_id !== null || row.status !== 'active')
          throw new Error(`${row.title} did not land in the Inbox as an active item`);
      }

      const byTitle = new Map(rows.map((row) => [row.title, row]));
      const codeRoot = byTitle.get('Per-voice mute');
      const codeChild = byTitle.get('Mute state');
      if (codeChild?.item_type !== 'code' || codeChild.parent_id !== codeRoot?.id)
        throw new Error('a code root’s child did not inherit its family');
      if (byTitle.get('Re-read the findings')?.item_type !== 'task')
        throw new Error('a task root’s child did not inherit its family');
      if (byTitle.get("Decide Q4's third rock")?.item_type !== 'unclassified')
        throw new Error('an item_type-less root did not default to unclassified');

      // The client sorts roots by created_at DESCENDING, and one transaction shares a single
      // now() — so without the per-index offset the week's order would be whatever order
      // Postgres happened to return.
      const rootTimes = ['Ship the spike', 'Per-voice mute', "Decide Q4's third rock"].map(
        (title) => new Date(byTitle.get(title)?.created_at ?? 0).getTime(),
      );
      const descends = rootTimes.every(
        (time, index) => index === 0 || time < (rootTimes[index - 1] ?? 0),
      );
      if (!descends)
        throw new Error(
          `root created_at did not descend with array position: ${rootTimes.join(',')}`,
        );

      return '7 rows, all stamped and undispatched; children inherit their root’s type; roots descend in order';
    },
  );

  const weeklyPlanAtomicResult = await attempt(
    'a batch whose second root is illegal writes nothing at all (ALF-195)',
    async () => {
      const plan = await seedPlan('<!doctype html><html><body>doomed</body></html>');
      // The route's schema rejects this shape long before the database sees it; the point is
      // that the database is a real backstop, and that the whole batch is ONE transaction.
      const batch = [
        { item_type: 'task', title: 'the good one' },
        { item_type: 'code', title: 'the bad one', due_date: '2026-09-08' },
      ];
      let raised = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(`select * from create_weekly_plan_items($1, $2::jsonb)`, [
            plan,
            JSON.stringify(batch),
          ]),
        );
      } catch {
        raised = true;
      }
      if (!raised) throw new Error('a due date on a code root was accepted');

      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from items where weekly_plan_id = $1`,
        [plan],
      );
      if (rows[0]?.count !== '0')
        throw new Error(`${String(rows[0]?.count)} row(s) survived a failed batch`);

      // An unknown plan is refused before anything is written, too.
      let unknownRaised = false;
      try {
        await asRole(client, 'authenticated', () =>
          client.query(`select * from create_weekly_plan_items($1, $2::jsonb)`, [
            '00000000-0000-0000-0000-000000000000',
            JSON.stringify([{ title: 'orphan' }]),
          ]),
        );
      } catch {
        unknownRaised = true;
      }
      if (!unknownRaised) throw new Error('a batch against an unknown plan was accepted');

      return 'the CHECK violation rolled the whole batch back; an unknown plan is refused';
    },
  );

  const weeklyPlanColumnResult = await attempt(
    'weekly_plan_id reaches the read path and survives the factory gate (ALF-195)',
    async () => {
      const plan = await seedPlan('<!doctype html><html><body>provenance</body></html>');
      const { rows } = await asRole(client, 'authenticated', () =>
        client.query<{ id: string; title: string }>(
          `select id, title from create_weekly_plan_items($1, $2::jsonb)`,
          [
            plan,
            JSON.stringify([
              { item_type: 'task', title: 'planned and filed' },
              { item_type: 'code', title: 'planned and gated' },
            ]),
          ],
        ),
      );
      const filed = rows.find((row) => row.title === 'planned and filed')?.id;
      const gated = rows.find((row) => row.title === 'planned and gated')?.id;
      if (filed === undefined || gated === undefined) throw new Error('the seed batch failed');

      // `select i.*` freezes a view's column list at CREATE time, so a migration that adds a
      // column without recreating task_items leaves it invisible to getAllItems() — and the
      // badge would read `undefined` where the type promises `string | null`.
      const viewed = await asRole(client, 'authenticated', () =>
        client.query<{ weekly_plan_id: string | null }>(
          `select weekly_plan_id from task_items where id = $1`,
          [filed],
        ),
      );
      if (viewed.rows[0]?.weekly_plan_id !== plan)
        throw new Error('task_items does not expose weekly_plan_id');

      // Provenance must outlive a type transition: the column is deliberately absent from
      // items_task_only_fields, so "I planned this and then sent it to the factory" is legal.
      await asRole(client, 'authenticated', () =>
        client.query(`select enter_code_module($1, $2, $3)`, [gated, PROJECT, EPIC]),
      );
      const afterGate = await client.query<{ weekly_plan_id: string | null; item_type: string }>(
        `select weekly_plan_id, item_type from items where id = $1`,
        [gated],
      );
      if (afterGate.rows[0]?.weekly_plan_id !== plan)
        throw new Error('enter_code_module dropped the cohort key');

      // Deleting the archived document must never delete the work it described.
      await client.query(`delete from weekly_plans where id = $1`, [plan]);
      const orphaned = await client.query<{ weekly_plan_id: string | null }>(
        `select weekly_plan_id from items where id = $1`,
        [filed],
      );
      if (orphaned.rowCount !== 1 || orphaned.rows[0]?.weekly_plan_id !== null)
        throw new Error('deleting the plan did not leave the item behind with a null key');

      return 'task_items exposes it, the factory gate keeps it, and deleting the plan nulls it without touching the work';
    },
  );

  const weeklyPlanGrantsResult = await attempt(
    'create_weekly_plan_items is security invoker and executable by all three API roles (ALF-195)',
    async () => {
      const { rows } = await client.query<{
        secdef: boolean;
        anon_exec: boolean;
        auth_exec: boolean;
        sr_exec: boolean;
      }>(
        `select p.prosecdef as secdef,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as sr_exec
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_weekly_plan_items'`,
      );
      const fn = rows[0];
      if (rows.length !== 1 || !fn)
        throw new Error(`expected one create_weekly_plan_items, found ${String(rows.length)}`);
      if (fn.secdef) throw new Error('the function is security definer, not invoker');
      // Security invoker means the inserts AND sort_order's nextval run as the calling role, so
      // a missing grant is a 500 the moment the coach calls it (the 0008 sequence lesson).
      if (!fn.anon_exec || !fn.auth_exec || !fn.sr_exec)
        throw new Error(
          `EXECUTE missing: anon=${String(fn.anon_exec)} authenticated=${String(fn.auth_exec)} service_role=${String(fn.sr_exec)}`,
        );
      return 'security invoker, EXECUTE granted to anon, authenticated and service_role';
    },
  );

  const codeDoneAtResult = await attempt(
    'code_items.done_at is stamped on the done transition and cleared when it leaves (ALF-195)',
    async () => {
      const { ref } = await createStory(client, 'the done-at probe');
      // `undefined` for "not done", so the assertions below read as plain equality checks
      // (`unicorn/no-null` forbids minting a null here; the column's null arrives as one).
      const doneAtOf = async (): Promise<string | undefined> => {
        const { rows } = await client.query<{ done_at: string | null }>(
          `select done_at from code_items where ref = $1`,
          [ref],
        );
        if (rows.length !== 1) throw new Error(`no such story: ${ref}`);
        return rows[0]?.done_at ?? undefined;
      };

      if ((await doneAtOf()) !== undefined)
        throw new Error('a fresh story already claims a done_at');

      // A DIRECT table UPDATE, not the app's route: the Worker patches code_items straight
      // through PostgREST when an implementation PR merges, and that is where most `done`
      // transitions come from.
      await client.query(`update code_items set factory_state = 'done' where ref = $1`, [ref]);
      const stamped = await doneAtOf();
      if (stamped === undefined) throw new Error('reaching done did not stamp done_at');

      // Re-saving the same state (a blocked_reason edit alongside it) must not restamp a
      // completion — the trigger fires on the column being MENTIONED, so the guard is the
      // `is distinct from` inside it.
      await client.query(
        `update code_items set factory_state = 'done', blocked_reason = null where ref = $1`,
        [ref],
      );
      if ((await doneAtOf()) !== stamped) throw new Error('re-setting the same state restamped');

      // An update that never mentions factory_state leaves it alone too.
      await client.query(`update code_items set blocked_reason = 'waiting' where ref = $1`, [ref]);
      if ((await doneAtOf()) !== stamped) throw new Error('an unrelated update restamped');

      await client.query(`update code_items set factory_state = 'in_development' where ref = $1`, [
        ref,
      ]);
      if ((await doneAtOf()) !== undefined)
        throw new Error('leaving done did not clear the completion it no longer asserts');

      return 'stamped on entering done, unchanged on a re-set or an unrelated edit, cleared on leaving';
    },
  );

  const backupDriftResult = await attempt(
    'the nightly backup survives a production database migrated ahead of the repo, and stays quiet ' +
      'when the repo is ahead instead',
    async () => {
      // The 2026-08-07 red run, exactly: the scheduled job checked out a main whose migrations
      // stopped at 0025 while the live `personal` database already had 0026. psql aborted the
      // load — `column "dispatched_at" of relation "items" does not exist` — and a sound 628 KB
      // dump was never uploaded. `migrate.yml` now applies on merge, so the repo is normally at
      // or ahead of production; this stays as the net under the cases that outlive it — a re-run
      // replaying a pinned commit, a merge landing mid-dump, a revert, hand-applied DDL.
      const stale = await staleVerifyDatabase(client);
      try {
        const present = await publicColumns(stale);
        if (present.get('items')?.includes('dispatched_at') === true)
          throw new Error('precondition failed: the stale verify schema already has dispatched_at');

        // Verbatim from the failing run's log.
        const dump =
          `COPY "public"."items" ("id", "title", "notes", "source_url", "item_type", ` +
          `"created_at", "raw_capture", "due_date", "status", "completed_at", "folder_id", ` +
          `"parent_id", "recurrence", "recurrence_series_id", "occurrence_index", "priority", ` +
          `"intended_project_id", "sort_order", "dispatched_at") FROM stdin;\n\\.\n`;
        const drift = schemaDrift(copiedTables(dump), present);
        const described = drift.map((d) => `${d.table}:${d.columns.join('+')}`).join(', ');
        if (described !== 'items:dispatched_at')
          throw new Error(`expected drift on items.dispatched_at, got ${described || 'none'}`);

        for (const statement of reconcileDriftStatements(drift)) {
          await stale.query(statement);
        }
        // The reconciled schema must now hold the shape the COPY was writing — that is the whole
        // point: the payload lands, gets counted, and the dump reaches R2.
        await stale.query(
          `insert into items (title, item_type, dispatched_at) values ('restored', 'task', now())`,
        );
        const { rows } = await stale.query<{ count: string }>(
          `select count(*)::text as count from items where dispatched_at is not null`,
        );
        if (rows[0]?.count !== '1')
          throw new Error(`reconciled schema did not accept the dispatched row (${described})`);

        // And the other direction stays silent: a dump taken between a merge and its migrate job,
        // or against an instance whose migrate job failed, is short a column — normal, not drift.
        const shortDump = `COPY public.items (id, title) FROM stdin;\n\\.\n`;
        const reverse = schemaDrift(copiedTables(shortDump), await publicColumns(stale));
        if (reverse.length > 0)
          throw new Error(
            `a dump short of the repo was reported as drift: ${String(reverse.length)}`,
          );

        return 'stale verifier detected items.dispatched_at, reconciled it, and accepted the row; a short dump reported no drift';
      } finally {
        await stale.end();
      }
    },
  );

  const backupVerifierShapeResult = await attempt(
    'the backup verifier builds every public table a deployed database carries',
    async () => {
      // The nightly went red every single night from 2026-08-08: `public.schema_migrations` is
      // created by the DEPLOYER (it has to exist before the first migration can be judged, so it
      // cannot itself be a migration), while the verify schema is built from `database/migrations`
      // alone — so the ledger was permanently absent from it. The `--schema public` dump always
      // carries the ledger, so every sound backup uploaded and then exited non-zero on a drift no
      // migration could ever close. Whatever the deployer leaves in `public`, the verifier builds.
      const deployed = await throwawayDatabase(client, 'alfred_backup_deployed');
      try {
        await deployMigrations(deployed);
        const verifier = await throwawayDatabase(client, 'alfred_backup_verifier');
        try {
          await buildVerifySchema(verifier);
          // What `supabase db dump --data-only --schema public` emits a COPY for: every public base
          // table, with the columns it holds. Read off a really-deployed database rather than
          // hand-written, so a table the deployer adds later is covered without touching this.
          const dumped = [...(await publicColumns(deployed))].map(([table, columns]) => ({
            table,
            columns,
          }));
          if (!dumped.some(({ table }) => table === 'schema_migrations'))
            throw new Error('precondition failed: the deployed database has no ledger to carry');

          const drift = schemaDrift(dumped, await publicColumns(verifier));
          if (drift.length > 0)
            throw new Error(
              `the verifier cannot build ${drift
                .map(({ table, columns, absent }) =>
                  absent ? `${table} (whole table)` : `${table}.${columns.join('+')}`,
                )
                .join(', ')}`,
            );
          return `${String(dumped.length)} deployed public tables, ledger included, all built by the verifier`;
        } finally {
          await verifier.end();
        }
      } finally {
        await deployed.end();
      }
    },
  );

  return [
    createStoryResult,
    enterModuleResult,
    swapResult,
    moveResult,
    projectScopedMoveResult,
    projectDefaultResult,
    inProjectRpcContractResult,
    outstandingProjectDefaultResult,
    outstandingProjectMoveResult,
    taskItemsColumnsResult,
    intendedProjectResult,
    intendedEpicResult,
    subtaskShapeResult,
    convertToEpicResult,
    convertTaskParentResult,
    codeStoryListReadResult,
    epicSpecColumnsResult,
    epicSpecViewResult,
    requiresRefinementResult,
    epicRealtimeResult,
    habitSchemaResult,
    habitEntryUniqueResult,
    habitCascadeResult,
    habitGrantsResult,
    folderSortOrderResult,
    entityDescriptionResult,
    habitAnonResult,
    anonInsertResult,
    anonReadResult,
    dispatchBackfillResult,
    dispatchInheritanceResult,
    dispatchFolderDeleteResult,
    dispatchCheckResult,
    dispatchOnGateResult,
    classifierColumnsResult,
    classifierClaimResult,
    classifierCorrectionsResult,
    correctionsGrantsResult,
    itemsRealtimeResult,
    weeklyPlanBatchResult,
    weeklyPlanAtomicResult,
    weeklyPlanColumnResult,
    weeklyPlanGrantsResult,
    codeDoneAtResult,
    backupDriftResult,
    backupVerifierShapeResult,
  ];
}
