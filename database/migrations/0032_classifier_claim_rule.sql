-- Alfred — the claim rule is drawn around what the classifier WRITES (ALF-202).
--
-- 0029 opted a row out of the sweep the moment a human edited any of eight fields, which caught
-- the two things you most often do to a fresh capture before it has been judged: giving it a
-- type, and typing a description into it. Both are self-defeating. The type is the price of
-- admission to everything else — an unclassified row shows no chip row and cannot take children
-- at all — so "classify it Task, then add its parts" spent its second step opting the item out
-- of the classifier permanently, on precisely the row that most needed a folder guess. And the
-- title and notes are the classifier's INPUT: they ride in the user message on every call, so
-- adding the sentence that would have made an ambiguous capture classifiable was the act that
-- guaranteed it never would be.
--
-- The rule that replaces it is narrower and says what it means: only a LABEL the classifier
-- writes claims a row. The type is defended the other way instead — the Worker's mergeIntoItem
-- never overwrites a type the item already holds, exactly as it never overwrites the project an
-- `ALF:`-prefixed capture arrived with. An insert has never claimed, so this also brings the UI
-- into line with the API, which could already POST a typed item and have the sweeper fill its
-- gaps.
--
-- Nothing is backfilled. Rows already claimed under the old rule stay claimed: the trigger
-- records no reason, so they cannot be told apart from rows a deliberate priority or folder edit
-- claimed, and re-opening the set would spend model calls on the whole Inbox.

-- ── 1. The claim rule, narrowed ──────────────────────────────────────────────
-- The trigger itself (items_claim_from_classifier, 0029) is NOT re-created — only the function
-- body is replaced, so nothing about its firing order moves. That order is load-bearing below.
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
    or (new.folder_id           is distinct from old.folder_id           and new.folder_id           is not null)
    or (new.intended_project_id is distinct from old.intended_project_id and new.intended_project_id is not null)
    or (new.intended_epic_id    is distinct from old.intended_epic_id    and new.intended_epic_id    is not null)
  ) then
    -- The provenance columns stay null on purpose: no model produced this.
    new.classified_at := now();
  end if;
  return new;
end; $$;

-- ── 2. A subtask being dispatched with no folder inherits its root's ─────────
-- The one consequence of the rule above that is not in the trigger. items_dispatched_needs_folder
-- (0026) requires a dispatched task to hold a folder; every existing folder writer cascades
-- across the subtree (setFolder, moveTask, bulkMove) but the classifier does not — it PATCHes one
-- row by id. So a decomposed task whose folder came from the model has children with a null
-- folder_id, and dispatching the subtree fails their writes on the CHECK. That was unreachable
-- only because classifying to add children used to claim the row; it is reachable now, and the
-- likely order is the bad one — children are usually added seconds after the classify, before the
-- next tick.
--
-- In the database rather than in dispatchItems, for 0026's stated reason: three ingresses already
-- dispatch (the bulk PATCH, enter_code_module, convert_to_code_epic) and only the database sits
-- under all of them. The two RPCs are no-ops here, since a code row is exempt by the guard below.
create or replace function inherit_folder_on_dispatch() returns trigger
language plpgsql security invoker as $$
declare v_root_folder uuid;
begin
  if new.parent_id is null                     then return new; end if;  -- roots carry their own
  if new.folder_id is not null                 then return new; end if;  -- already labelled
  if new.item_type = 'code'                    then return new; end if;  -- exempt from the CHECK
  if old.dispatched_at is not null
     or new.dispatched_at is null              then return new; end if;  -- only the transition
  -- The ROOT's folder, not the parent's: the subtree's PATCHes are issued together, so at depth
  -- >= 2 a middle row may not have been filled in yet when its child's trigger runs. Walking to
  -- the root is the only reading that is order-independent, and it matches the app's own
  -- invariant that a subtree shares one folder bucket.
  with recursive ancestry as (
    select id, parent_id, folder_id from items where id = new.parent_id
    union all
    select i.id, i.parent_id, i.folder_id from items i join ancestry a on i.id = a.parent_id
  )
  select folder_id into v_root_folder from ancestry where parent_id is null;
  new.folder_id := v_root_folder;
  return new;
end; $$;

-- The name is load-bearing. Postgres fires `before update` row triggers in ALPHABETICAL order,
-- and items_claim_from_classifier sorts before items_inherit_folder_on_dispatch — so the claim
-- trigger sees folder_id still null and does not claim the child on its way through. A rename
-- that reversed the order would silently start stamping every inheriting child, which is why the
-- ordering has its own assertion in the database integration suite.
create trigger items_inherit_folder_on_dispatch
  before update on items
  for each row execute function inherit_folder_on_dispatch();

-- ── 3. The column comment that now says something false ─────────────────────
-- 0029's comment enumerates the watched fields as "a classifier-written field", which the two
-- exclusions above make imprecise. Re-state it so the schema documents the rule it has rather
-- than the one it shipped with. classified_provider's comment ("a human edit claimed the row
-- before the sweeper reached it") is still exactly true and is left alone.
comment on column items.classified_at is
  'When this item stopped being eligible for the classifier sweep. NULL = eligible. Set either '
  'by the classifier writing a verdict or by the claim trigger when a human edits a LABEL the '
  'classifier writes (priority, due_date, or one of the three id hints, set to a non-null value). '
  'Editing the captured TEXT (title, notes) or setting item_type deliberately does NOT claim: the '
  'first is the classifier''s input, the second is locked against it in the Worker (ALF-202).';

-- No column, table, view or grant changes here, so the 0011/0013/0026/0029 view-freeze trap does
-- not apply and task_items is left alone. The reload is for the comment above, which PostgREST
-- serves as the column's description.
notify pgrst, 'reload schema';
