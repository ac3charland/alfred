-- Alfred — a task can carry a time as well as a date (ALF-161).
--
-- `items.due_date` is a timestamptz in type only: every reader and writer treats it as a calendar
-- date (a bare YYYY-MM-DD in, UTC midnight stored, read back as that same local date). A time is
-- therefore its own column rather than a real instant packed into due_date — an evening time west
-- of UTC would roll that instant onto the next UTC day and break every `.slice(0, 10)`, the
-- corrections log's UTC to_char, and the Worker, which would need the owner's zone to write one.
--
-- `due_time` is a wall-clock "floating" time, the same way due_date is a floating date: 3 PM means
-- 3 PM on whatever device is reading it, across DST and travel. Date-only code is untouched; only
-- time-aware code reads the second field.
--
-- Five pieces:
--   1. The column, plus the rule that a time never outlives its date.
--   2. A re-expanded task_items view, so the column reaches the read path at all.
--   3. The classifier's claim rule learns the new label.
--   4. complete_and_spawn carries the time onto the next occurrence.
--   5. The dispatch-time corrections diff compares it.

-- ── 1. The column + its rule ─────────────────────────────────────────────────
alter table items add column due_time time;

comment on column items.due_time is
  'Wall-clock due time (HH:MM, no zone), floating like due_date: meaningful only beside a date. '
  'NULL = due any time that day. ALF-161.';

-- No change to items_task_only_fields: a time implies a date, and a date already implies a task.
alter table items add constraint items_due_time_needs_date
  check (due_time is null or due_date is not null);

-- The backstop for every writer that clears the date without knowing a time exists —
-- enter_code_module, convert_to_code_epic, and whatever RPC comes next — so none of them needs
-- redefining. It fires only on the set → null transition of the date, so a time sent for a row
-- that never had a date still fails the CHECK above loudly instead of silently vanishing.
create or replace function clear_due_time_with_date() returns trigger
language plpgsql security invoker as $$
begin
  if old.due_date is not null and new.due_date is null then
    new.due_time := null;
  end if;
  return new;
end; $$;

create trigger items_clear_due_time_with_date
  before update of due_date on items
  for each row execute function clear_due_time_with_date();

-- ── 2. Re-expand the task_items view ─────────────────────────────────────────
-- MANDATORY. `select i.*` freezes its column list at CREATE time, so due_time would be invisible
-- to the whole read path until the view is recreated — the bug 0011, 0013, 0018, 0026, 0029 and
-- 0030 each document. `create or replace` (no drop), so the grants and security_invoker survive.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

-- ── 3. A human time edit claims the row from the classifier ──────────────────
-- The classifier now writes due_time, so by the 0032 rule (only a label the classifier WRITES
-- claims a row) it joins the watched fields. The body is 0032's verbatim; only the condition list
-- gains a line.
create or replace function claim_item_from_classifier() returns trigger
language plpgsql security invoker as $$
begin
  -- A non-null classified_at means either the classifier is stamping its own verdict in this
  -- very statement, or the row is already spoken for. Either way there is nothing to claim.
  --
  -- Only the fields the classifier WRITES claim the row. title and notes are its INPUT —
  -- improving the text it reads must not cancel the reading — and item_type is locked against
  -- the model in the Worker rather than defended by opting the row out, so that classifying a
  -- capture (the only way to give it children) still leaves it eligible.
  --
  -- The three FK columns still claim only in the NON-NULL direction, verbatim from 0029, and
  -- that carve-out is still load-bearing: all three are `on delete set null`, so deleting a
  -- folder writes them with no human stating anything, and 0026's return_folder_items_to_inbox
  -- deliberately sends that folder's items back to the Inbox. A naive watch would claim every
  -- one of those rows on its way back, permanently hiding the items that most need re-triaging.
  if new.classified_at is null and (
       new.priority  is distinct from old.priority
    or new.due_date  is distinct from old.due_date
    or new.due_time  is distinct from old.due_time
    or (new.folder_id           is distinct from old.folder_id           and new.folder_id           is not null)
    or (new.intended_project_id is distinct from old.intended_project_id and new.intended_project_id is not null)
    or (new.intended_epic_id    is distinct from old.intended_epic_id    and new.intended_epic_id    is not null)
  ) then
    -- The provenance columns stay null on purpose: no model produced this.
    new.classified_at := now();
  end if;
  return new;
end; $$;

-- ── 4. complete_and_spawn carries the time ───────────────────────────────────
-- Rebuilt from 0006, its only definition; the two inserts each gain due_time (the root its own,
-- every child its own — children keep their own dates the same way). Its column list still
-- predates priority, which a separate fix restores: whichever of the two lands second must
-- rebuild from the other's definition.
create or replace function complete_and_spawn(
  root_id uuid,
  next_due timestamptz,
  next_index int
)
returns json
language plpgsql
security invoker
as $$
declare
  new_root_id uuid := gen_random_uuid();
  completed_json json;
  spawned_json json;
begin
  -- Capture active descendants (excluding root) before completing.
  -- Each row gets a pre-assigned new UUID for the deep-copy step.
  drop table if exists _ctas_children;
  create temp table _ctas_children on commit drop as
    with recursive tree as (
      select id, parent_id, 0 as depth
      from items
      where id = root_id
      union all
      select c.id, c.parent_id, t.depth + 1
      from items c
      join tree t on c.parent_id = t.id
      where t.depth < 50
    )
    select i.*, gen_random_uuid() as spawned_id
    from items i
    join tree t on i.id = t.id
    where i.id != root_id
      and i.status = 'active';

  -- Complete the subtree and capture the resulting rows.
  select json_agg(row_to_json(r))
  into completed_json
  from complete_subtree(root_id) as r;

  -- Insert the new root occurrence, copying the recurring task's own fields.
  -- (Root is now completed in the DB but non-status fields are still readable.)
  insert into items (
    id, title, notes, source_url, folder_id, item_type, raw_capture,
    recurrence, recurrence_series_id, due_date, due_time, occurrence_index,
    status, completed_at, parent_id
  )
  select
    new_root_id, title, notes, source_url, folder_id, item_type, raw_capture,
    recurrence, recurrence_series_id, next_due, due_time, next_index,
    'active'::item_status, null::timestamptz, null::uuid
  from items
  where id = root_id;

  -- Deep-copy active children with fresh IDs, remapping parent_id references
  -- within the subtree. Children do not inherit recurrence.
  insert into items (
    id, title, notes, source_url, folder_id, item_type, raw_capture,
    parent_id, recurrence, recurrence_series_id, due_date, due_time, occurrence_index,
    status, completed_at
  )
  select
    c.spawned_id,
    c.title, c.notes, c.source_url, c.folder_id, c.item_type, c.raw_capture,
    case
      when c.parent_id = root_id then new_root_id
      else (select p.spawned_id from _ctas_children p where p.id = c.parent_id)
    end,
    null::jsonb,
    null::uuid,
    c.due_date,
    c.due_time,
    null::int,
    'active'::item_status,
    null::timestamptz
  from _ctas_children c;

  -- Fetch and return the spawned root.
  select row_to_json(i)
  into spawned_json
  from items i
  where id = new_root_id;

  return json_build_object(
    'completed', coalesce(completed_json, '[]'::json),
    'spawned', spawned_json
  );
end;
$$;

-- ── 5. The corrections diff compares the time ────────────────────────────────
alter table classification_corrections drop constraint classification_corrections_field_valid;
alter table classification_corrections add constraint classification_corrections_field_valid
  check (field in ('item_type', 'priority', 'due_date', 'due_time',
                   'folder_id', 'intended_project_id', 'intended_epic_id'));

-- The body is 0029's verbatim plus the due_time row. The model's guess is a bare HH:MM, so the
-- chosen time is rendered the same way (Postgres would print HH:MM:SS) — like with like.
create or replace function log_classification_corrections() returns trigger
language plpgsql security invoker as $$
declare
  v_text  text := new.title || coalesce(E'\n' || new.notes, '');
  v_field text;
  v_guessed text;
  v_chosen  text;
begin
  for v_field, v_guessed, v_chosen in
    select * from (values
      -- 'unclassified' is items.item_type's default, i.e. the absence of a decision, so it
      -- compares as NULL here rather than as a chosen label.
      ('item_type', old.classified_guess ->> 'item_type',
                    nullif(new.item_type::text, 'unclassified')),
      ('priority',  old.classified_guess ->> 'priority', new.priority::text),
      -- The model emits a bare YYYY-MM-DD, which Postgres stored as UTC midnight; read it back
      -- the same way so the comparison is like with like rather than string-vs-timestamp.
      ('due_date',  old.classified_guess ->> 'due_date',
                    to_char(new.due_date at time zone 'UTC', 'YYYY-MM-DD')),
      ('due_time',  old.classified_guess ->> 'due_time', to_char(new.due_time, 'HH24:MI')),
      ('folder_id', old.classified_guess ->> 'folder_id', new.folder_id::text),
      ('intended_project_id', old.classified_guess ->> 'intended_project_id',
                              new.intended_project_id::text),
      ('intended_epic_id',    old.classified_guess ->> 'intended_epic_id',
                              new.intended_epic_id::text)
    ) as guessed_vs_chosen(field, guessed, chosen)
  loop
    continue when v_guessed is not distinct from v_chosen;
    insert into classification_corrections (
      item_id, captured_text, field, direction, guessed_value, chosen_value,
      provider, model, prompt_version
    ) values (
      new.id, v_text, v_field,
      case
        when v_guessed is null then 'filled_in'
        when v_chosen  is null then 'blanked'
        else 'changed'
      end,
      v_guessed, v_chosen,
      old.classified_provider, old.classified_model, old.classified_prompt_version
    );
  end loop;
  return null;
end; $$;

notify pgrst, 'reload schema';
