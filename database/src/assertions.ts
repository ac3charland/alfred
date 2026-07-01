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
): Promise<{ ref: string; priority: string }> {
  const { rows } = await asRole(client, 'authenticated', () =>
    client.query<{ ref: string; priority: string }>(
      `select ref, priority from create_code_story($1, $2, $3)`,
      [PROJECT, EPIC, title],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('create_code_story returned no row');
  return row;
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
    taskItemsColumnsResult,
    anonInsertResult,
    anonReadResult,
  ];
}
