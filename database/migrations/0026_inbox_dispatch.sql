-- Alfred — Inbox residency becomes an explicit column (ALF-168).
--
-- "In the Inbox" has been a DERIVED fact: `folder_id is null`. That identity — having no folder
-- ≡ waiting for triage — only holds while nothing but a human can write `folder_id`. The LLM
-- classifier is about to write its guesses onto an item's real fields, `folder_id` included, and
-- under the old rule an item would silently vanish from the Inbox into a folder before its owner
-- had ever seen it.
--
-- So residency and location become two different facts. `dispatched_at is null` means "still in
-- the Inbox", whatever `folder_id` holds, and only a human act stamps it:
--
--     dispatched_at | folder_id | renders in
--     --------------+-----------+---------------------------------------
--     null          | null      | Inbox (an ordinary capture)
--     null          | set       | Inbox (a guess the owner hasn't seen)
--     set           | set       | that folder
--     set           | null      | nowhere — rejected by the CHECK below,
--                   |           | except for a code item (it left for the
--                   |           | factory, which has no folders)
--
-- Nothing user-visible changes when this lands: nothing in the app writes `folder_id` without
-- also dispatching, so the old rule and the new one agree on every existing row.

-- ── 1. The column ────────────────────────────────────────────────────────────
alter table items add column dispatched_at timestamptz;

comment on column items.dispatched_at is
  'When a human dispatched this item out of the Inbox. NULL = still in the Inbox, REGARDLESS of '
  'folder_id — location (which folder it would land in) and residency (which view shows it) are '
  'two different facts, and only a human act may change residency. A folder view lists items '
  'with this set; the Inbox lists items with it null.';

-- ── 2. Backfill: everything currently in a folder is already dispatched ──────
-- now(), not created_at: the real dispatch time is unknown for historical rows and created_at
-- would assert something false (that the item was triaged the instant it was captured). The
-- migration timestamp honestly means "dispatched at or before this migration", and nothing
-- reads the value — only its null-ness.
update items set dispatched_at = now() where folder_id is not null;

-- ── 3. "Dispatched but nowhere" is impossible ────────────────────────────────
-- Added AFTER the backfill, or it would reject the existing rows. A dispatched TASK must hold a
-- folder; a dispatched CODE item is the deliberate exception (it leaves for the factory). This
-- does not constrain a classifier guess: a folder_id on an undispatched row satisfies the first
-- disjunct. The failure mode it replaces is silent (an item that exists but renders in no view);
-- the one it introduces is a loud, immediate write error.
alter table items add constraint items_dispatched_needs_folder check (
  dispatched_at is null or folder_id is not null or item_type = 'code'
);

-- ── 4. The Inbox read's index ────────────────────────────────────────────────
-- Partial, because every query that cares selects exactly this set: the Inbox list, and the
-- future sweeper that hunts for items still awaiting triage.
create index items_undispatched_idx on items (dispatched_at) where dispatched_at is null;

-- ── 5. A new item inherits residency at insert ───────────────────────────────
-- In the database, not the route: two ingresses already create filed items (a folder view's
-- capture box, and the inline "add subtask" field, which passes its parent's folder_id), and
-- Siri/service-role writes bypass the route entirely.
--
-- Parent inheritance rather than "a folder means dispatched": once a classifier can put a
-- folder_id on an UNdispatched item, adding a subtask to it would otherwise create a dispatched
-- child under an undispatched parent — a subtree split across two views, whose orphaned half
-- vanishes (the client filters flat before building the tree). Inheriting is correct in both
-- worlds, so it is written once, now.
create or replace function inherit_dispatched_at() returns trigger
language plpgsql security invoker as $$
declare v_parent_dispatched_at timestamptz;
begin
  -- An explicit value wins: the factory RPCs stamp the row themselves.
  if new.dispatched_at is not null then return new; end if;
  if new.parent_id is not null then
    select dispatched_at into v_parent_dispatched_at from items where id = new.parent_id;
    -- `found`, not a null test on the value: an undispatched parent yields NULL, which is the
    -- residency to inherit, not a missing row. A missing row is enforce_subtask_shape's error
    -- to raise, not this trigger's — fall through so the two can't disagree about who complains.
    if found then
      new.dispatched_at := v_parent_dispatched_at;
      return new;
    end if;
  end if;
  if new.folder_id is not null then
    new.dispatched_at := now();
  end if;
  return new;
end; $$;

create trigger items_inherit_dispatched_at
  before insert on items
  for each row execute function inherit_dispatched_at();

-- ── 6. Deleting a folder returns its items to the Inbox — explicitly now ─────
-- items.folder_id is `on delete set null`, so losing the folder USED to BE returning to the
-- Inbox. Now that residency is its own column that stops being free: the rows would keep a
-- non-null dispatched_at with no folder and render nowhere at all (and trip the CHECK above).
-- A before-delete trigger clears their residency, so today's behaviour survives.
create or replace function return_folder_items_to_inbox() returns trigger
language plpgsql security invoker as $$
begin
  update items set dispatched_at = null where folder_id = old.id;
  return old;
end; $$;

create trigger folders_return_items_to_inbox
  before delete on folders
  for each row execute function return_folder_items_to_inbox();

-- ── 7. Re-expand the task_items view ─────────────────────────────────────────
-- MANDATORY. `select i.*` freezes its column list at CREATE time, so dispatched_at is invisible
-- to the read path until the view is recreated — the bug 0011 and 0013 both document. `create or
-- replace` (no drop), so the grants and security_invoker survive.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

-- ── 8. The two factory RPCs stamp residency as they consume an item ──────────
-- A gated item leaves task_items anyway, so this is about the PREDICATE, not the view: with it,
-- "dispatched_at is null" means "still in the Inbox" for EVERY row, rather than "every row
-- except the ones that took the other exit".
--
-- Both bodies are copied VERBATIM from the migration that last defined them — enter_code_module
-- from 0014, convert_to_code_epic from 0019 — with only the one assignment added. Re-deriving a
-- body from an older migration silently reverts later fixes (0025 documents that exact trap).

create or replace function enter_code_module(p_item uuid, p_project uuid, p_epic uuid)
returns code_items language plpgsql security invoker as $$
declare n int; k text; v_priority double precision; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-110: land at the top of the item's own project, not the whole Backlog.
  v_priority := top_of_project_priority(p_project);
  update items set item_type = 'code', due_date = null, parent_id = null,
                   status = 'active', completed_at = null, dispatched_at = now()
    where id = p_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
  values (p_item, p_project, p_epic, n, k || '-' || n, v_priority) returning * into row;
  return row;
end; $$;

grant execute on function enter_code_module(uuid, uuid, uuid)
  to anon, authenticated, service_role;

create or replace function convert_to_code_epic(p_item uuid, p_project uuid)
returns json language plpgsql security invoker as $$
declare
  v_parent items; v_epic epics; v_child items; v_row code_items;
  v_key text; v_n int; v_priority double precision;
  v_stories code_items[] := '{}';
begin
  select * into v_parent from items where id = p_item;
  if v_parent is null then raise exception 'item % not found', p_item; end if;
  select key into v_key from projects where id = p_project;

  -- The parent IS the epic: same title, same notes, ref from the shared project counter.
  select * into v_epic from create_epic(p_project, v_parent.title);
  if v_parent.notes is not null then
    update epics set notes = v_parent.notes where id = v_epic.id returning * into v_epic;
  end if;

  -- Active children, BOTTOM-UP: each top_of_project_priority() call lands the next child
  -- ABOVE the previous one, so display order comes out as priority order (first child highest).
  for v_child in
    select * from items
     where parent_id = p_item and status = 'active'
     order by sort_order desc, created_at desc
  loop
    v_n        := next_code_ref(p_project);
    v_priority := top_of_project_priority(p_project);
    update items set item_type = 'code', due_date = null, parent_id = null,
                     status = 'active', completed_at = null, dispatched_at = now()
      where id = v_child.id;
    insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
    values (v_child.id, p_project, v_epic.id, v_n, v_key || '-' || v_n, v_priority)
    returning * into v_row;
    v_stories := v_row || v_stories;   -- prepend, so the array comes back in display order
  end loop;

  -- Consume the parent: a task keeps its history (completed, completed children still
  -- beneath it); a code inbox row has no completion, so it is deleted.
  if v_parent.item_type = 'task' then
    update items set status = 'completed', completed_at = now() where id = p_item;
  else
    delete from items where id = p_item;
  end if;

  return json_build_object('epic', to_json(v_epic), 'stories', to_json(v_stories));
end; $$;

grant execute on function convert_to_code_epic(uuid, uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
