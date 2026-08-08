-- 0027_intended_epic.sql — ALF-170: a code-classified INBOX item may carry an intended epic.
--
-- The pre-factory epic hint, mirroring 0013's intended_project_id: a code-classified inbox item
-- can already name the project it would land in, but not the epic — so dispatching it without a
-- dialog has nowhere to read the epic from. code_items.epic_id stays authoritative once the item
-- enters the factory; this is only the pre-factory Inbox hint.
alter table items
  add column intended_epic_id uuid references epics (id) on delete set null;

-- on delete set null: deleting an epic must not break an Inbox row — the item loses its hint,
-- keeps its project, and simply stops being dispatch-ready until an epic is chosen. Deleting the
-- project cascades its epics away (epics.project_id … on delete cascade) and nulls both hints.
comment on column items.intended_epic_id is
  'The pre-factory epic hint: which epic a code-classified Inbox item would enter the factory '
  'under. Mirrors intended_project_id; code_items.epic_id is authoritative once the item is in '
  'the factory.';

-- Only a code item may hold an intended epic (keeps unclassified/task rows clean — the twin of
-- items_intended_project_code_only).
alter table items add constraint items_intended_epic_code_only check (
  intended_epic_id is null or item_type = 'code'
);

create index items_intended_epic_id_idx on items (intended_epic_id);

-- An epic belongs to a project, so the two hints can disagree — and a CHECK can't see another
-- table, hence the trigger (the same reasoning as enforce_subtask_shape in 0019). Without it,
-- enter_code_module(p_item, p_project, p_epic) — which validates neither argument against the
-- other — could be fed an incoherent pair straight off the row, creating a story in one project
-- filed under another project's epic. This makes that a loud write error on the offending
-- request instead. An intended_epic_id with no intended_project_id is rejected by the same
-- distinct-from branch.
--
-- A DEFERRED CONSTRAINT trigger, not a BEFORE trigger: deleting a project cascades its epics
-- away AND nulls the item's project hint, and those two referential set-nulls land in an
-- arbitrary order — a BEFORE trigger fires mid-cascade on each one and raises on the transient
-- half-updated row, making the delete itself fail. Deferring the check to commit judges only
-- the settled state, so the cascade nulls both hints and passes while a genuinely incoherent
-- user write still raises (PostgREST runs each request in its own transaction, so the error
-- still surfaces on that request). Same reason the row is RE-READ rather than judged from NEW:
-- at commit the queue holds one event per intermediate update, each carrying its stale NEW.
create or replace function enforce_intended_epic_project() returns trigger
language plpgsql security invoker as $$
declare v_epic uuid; v_item_project uuid; v_epic_project uuid;
begin
  select intended_epic_id, intended_project_id into v_epic, v_item_project
    from items where id = new.id;
  if not found or v_epic is null then return null; end if;
  select project_id into v_epic_project from epics where id = v_epic;
  if not found then
    raise exception 'epic % not found', v_epic;
  end if;
  if v_item_project is distinct from v_epic_project then
    raise exception 'intended epic % does not belong to intended project %',
      v_epic, v_item_project;
  end if;
  return null;
end; $$;

create constraint trigger items_intended_epic_project
  after insert or update of intended_epic_id, intended_project_id on items
  deferrable initially deferred
  for each row execute function enforce_intended_epic_project();

-- A `select i.*` view freezes its column list at CREATE time (see 0011), so a column added to
-- items afterwards never appears in the view until it is recreated. getAllItems() reads
-- task_items, so recreate it here to surface intended_epic_id. No drop, so the existing grants
-- and security_invoker survive; the leading columns are unchanged and the new one lands at the end.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

notify pgrst, 'reload schema';
