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
    subtaskShapeResult,
    convertToEpicResult,
    convertTaskParentResult,
    codeStoryListReadResult,
    epicSpecColumnsResult,
    epicSpecViewResult,
    epicRealtimeResult,
    habitSchemaResult,
    habitEntryUniqueResult,
    habitCascadeResult,
    habitGrantsResult,
    habitAnonResult,
    anonInsertResult,
    anonReadResult,
  ];
}
