import type { Client } from 'pg';

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
async function attempt(name: string, fn: () => Promise<string>): Promise<AssertionResult> {
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

  return [
    createStoryResult,
    enterModuleResult,
    swapResult,
    moveResult,
    projectScopedMoveResult,
    projectDefaultResult,
    inProjectRpcContractResult,
    taskItemsColumnsResult,
    intendedProjectResult,
    anonInsertResult,
    anonReadResult,
  ];
}
