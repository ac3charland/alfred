-- Alfred — weekly-plan items: the cohort key, the batch RPC, and the factory's done stamp
-- (ALF-195).
--
-- The Friday review already archives a week-plan HTML document (0022). Nothing in it ever
-- became real work, so at the next review there was no way to ask "of the things we agreed to
-- do, which are done?". Two endpoints close that loop: one writes a week's items against the
-- plan they came from, one reads the same cohort back. This migration is everything those
-- endpoints stand on:
--
--   1. items.weekly_plan_id — provenance, the cohort key, and the badge's only input.
--   2. A re-expanded task_items view, so the new column reaches the read path at all.
--   3. create_weekly_plan_items(plan, items) — a week lands whole or not at all.
--   4. code_items.done_at + its trigger — the one timestamp the factory never kept.

-- ── 1. The cohort key ────────────────────────────────────────────────────────
-- The plan's id, not a week date: a date is a second notion of "which week" that nothing else
-- in the schema shares and that only the caller's arithmetic defends — two calls a minute apart
-- can disagree and silently split a cohort. The plan row is already the thing the review
-- produced, and joining to it hands the read its uploaded_at for free.
alter table items
  add column weekly_plan_id uuid references weekly_plans (id) on delete set null;

comment on column items.weekly_plan_id is
  'The archived week-plan document this item was created from (ALF-195). NULL = an ordinary '
  'capture. Written by create_weekly_plan_items on the root AND every child, so the cohort is '
  'one query. on delete set null: the item is real work and outlives the plan document.';

-- The only query shape: "every item belonging to this plan".
create index items_weekly_plan_id_idx on items (weekly_plan_id)
  where weekly_plan_id is not null;

-- Deliberately NOT added to items_task_only_fields. The column is provenance, and it must
-- survive every type transition the app already performs — enter_code_module flips an item to
-- code in place, and a CHECK naming the column would turn "I planned this and then sent it to
-- the factory" into a write error on a legitimate flow.

-- ── 2. Re-expand the task_items view ─────────────────────────────────────────
-- MANDATORY. `select i.*` freezes its column list at CREATE time, so weekly_plan_id would be
-- invisible to the whole read path until the view is recreated — the bug 0011, 0013, 0018, 0026
-- and 0029 each document. getAllItems() reads this view with .overrideTypes<Item[]>(), and Item
-- is the TABLE row type, so a column on the table but not the view yields `undefined` where the
-- type promises `string | null` — and the badge would read that undefined.
-- `create or replace` (no drop), so the grants and security_invoker survive.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

-- v_code_stories is deliberately left alone: it enumerates its columns explicitly, and nothing
-- in the code module reads the cohort. Adding the column there later is one line.

-- ── 3. The batch RPC — a week lands whole or not at all ──────────────────────
-- Roots and children can't go in one PostgREST insert (children need their parents' ids), and
-- two round trips are two transactions — a failure on the second leaves a half-created week of
-- childless roots that nobody can tell apart from a plan that really had no subtasks. A plpgsql
-- function is one statement, so it is one transaction. The repo's existing answer to "the client
-- needs several related rows written together": convert_to_code_epic, complete_and_spawn.
create or replace function create_weekly_plan_items(p_plan uuid, p_items jsonb)
returns setof items
language plpgsql
security invoker
as $$
declare
  v_now   timestamptz := now();
  v_index int := 0;
  v_item  jsonb;
  v_child jsonb;
  v_type  item_type;
  v_root  items;
  v_kid   items;
begin
  if not exists (select 1 from weekly_plans where id = p_plan) then
    raise exception 'weekly plan % not found', p_plan;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    -- The route's schema has already rejected every field this type may not carry, so the
    -- inserts below need no per-type branching: an absent key is simply NULL.
    v_type := coalesce(v_item ->> 'item_type', 'unclassified')::item_type;

    -- One transaction shares a single now(), and the client sorts roots by created_at
    -- descending. Twenty identical timestamps means the tie-break is whatever order Postgres
    -- happens to return — unstable across reloads. Descending offsets make array position 0 the
    -- newest row, so the Inbox reads top-down in the order the caller sent. Never in the future;
    -- at most 100ms of spread at the batch cap.
    insert into items (title, notes, item_type, due_date, priority, weekly_plan_id, created_at)
    values (
      v_item ->> 'title',
      v_item ->> 'notes',
      v_type,
      (v_item ->> 'due_date')::timestamptz,
      (v_item ->> 'priority')::task_priority,
      p_plan,
      v_now - (v_index * interval '1 millisecond')
    )
    returning * into v_root;
    return next v_root;

    -- Children inherit the root's type (enforce_subtask_shape forbids mixing families) and its
    -- created_at: a subtask group sorts by sort_order, whose sequence default increments per
    -- insert, so array order is preserved with nothing to compute.
    for v_child in
      select * from jsonb_array_elements(coalesce(v_item -> 'children', '[]'::jsonb))
    loop
      insert into items (title, notes, item_type, due_date, priority, weekly_plan_id,
                         parent_id, created_at)
      values (
        v_child ->> 'title',
        v_child ->> 'notes',
        v_type,
        (v_child ->> 'due_date')::timestamptz,
        (v_child ->> 'priority')::task_priority,
        p_plan,
        v_root.id,
        v_root.created_at
      )
      returning * into v_kid;
      return next v_kid;
    end loop;

    v_index := v_index + 1;
  end loop;
end; $$;

-- security invoker: the column defaults (sort_order's nextval) and the row inserts run as the
-- CALLING role, so all three need EXECUTE (the 0008 sequence-grant lesson's sibling).
grant execute on function create_weekly_plan_items(uuid, jsonb)
  to anon, authenticated, service_role;

-- The database is the backstop, not the validator: items_task_only_fields rejects a due date on
-- a non-task row and enforce_subtask_shape rejects a mixed family, so a schema bug fails loudly
-- and atomically instead of writing an incoherent week. dispatched_at is never set, so 0026's
-- inherit_dispatched_at leaves root and children alike in the Inbox and the pair can't be split
-- across two views.

-- ── 4. code_items.done_at — the one timestamp the factory never kept ─────────
-- The review asks "when was this done?" of every line of its plan. A task answers with
-- items.completed_at; a code story had no answer at all — code_items carries only created_at and
-- updated_at, nothing writes updated_at, and there is no transition log anywhere in the schema.
alter table code_items add column done_at timestamptz;

comment on column code_items.done_at is
  'When factory_state last became ''done'' (ALF-195). NULL = not done, or done before this '
  'migration (nothing to backfill from — the factory kept no transition history). Cleared when '
  'the state moves off ''done'', so it never asserts a completion that was undone.';

-- In a trigger, not in PATCH /api/code/[ref]: the Worker patches code_items straight through
-- PostgREST when an implementation PR merges, which is where most `done` transitions come from,
-- and never passes through the route. Same argument as 0026's inherit_dispatched_at — several
-- ingresses write the column and only the database sits under all of them.
--
-- A dedicated column rather than stamping updated_at: "last touched" is not "finished", so an
-- epic move or an unblock after completion would drag the timestamp forward and the review would
-- report the wrong day.
create or replace function stamp_code_item_done_at() returns trigger
language plpgsql security invoker as $$
begin
  -- `is distinct from` rather than the bare column mention the trigger fires on: re-saving the
  -- same state (a blocked_reason edit alongside it) must not restamp a completion.
  if new.factory_state is distinct from old.factory_state then
    new.done_at := case when new.factory_state = 'done' then now() end;
  end if;
  return new;
end; $$;

create trigger code_items_stamp_done_at
  before update of factory_state on code_items
  for each row execute function stamp_code_item_done_at();

notify pgrst, 'reload schema';
