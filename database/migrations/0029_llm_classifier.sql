-- Alfred — the LLM classifier's schema: provenance, the claim rule, and the correction log.
--
-- A scheduled Worker reads the Inbox items nobody has touched yet, asks a small model for a
-- verdict about each one, and writes the guesses onto the item's REAL fields — there is no
-- suggestion sidecar and no "proposed" state. Three things follow, and all three live here
-- rather than in a route, because every ingress (the Next.js PATCH, the factory RPCs, a
-- service-role write from Siri) passes through the database and none of them can forget it:
--
--   1. Provenance. Six columns recording that the classifier ran, what produced the verdict,
--      and the verdict itself. `classified_at` doubles as the sweep's idempotency marker.
--   2. The claim rule. Any human edit to a classifier-written field stamps `classified_at`,
--      so the sweeper never revisits — and can never change your answer back.
--   3. The correction log. Dispatch is the one unambiguous "these labels are final" event, so
--      that transition diffs the stored guess against the row as it now stands and appends one
--      row per disagreement. The next sweep reads them back as worked examples.
--
-- Nothing here is rendered. The columns ride the read path unseen, exactly as dispatched_at
-- does today, and the corrections table has no reader outside the Worker's prompt assembly.

-- ── 1. Provenance on items ───────────────────────────────────────────────────
alter table items
  add column classified_at             timestamptz,
  add column classified_provider       text,
  add column classified_model          text,
  add column classified_prompt_version int,
  add column classified_guess          jsonb,
  add column classify_attempts         int not null default 0;

comment on column items.classified_at is
  'When this item stopped being eligible for the classifier sweep. NULL = eligible. Set either '
  'by the classifier writing a verdict or by the claim trigger below when a human edits a '
  'classifier-written field — one marker, so the two can never disagree about eligibility.';
comment on column items.classified_provider is
  'Which provider produced the verdict, e.g. ''anthropic''. NULL alongside a non-null '
  'classified_at means NO MODEL RAN: a human edit claimed the row before the sweeper reached it. '
  'A column rather than a constant so a future provider comparison is a query, not a migration.';
comment on column items.classified_model is
  'The resolved model id the verdict came from, e.g. ''claude-haiku-4-5'' — the Worker var as it '
  'stood at write time, not a constant.';
comment on column items.classified_prompt_version is
  'The prompt version that produced the verdict — a module constant in the Worker, bumped by '
  'hand when the prompt text or the output schema changes meaningfully. It is what makes a '
  'prompt change safely replayable over old captures.';
comment on column items.classified_guess is
  'The validated verdict exactly as written, kept so the dispatch-time diff has something to '
  'compare against. Written once by the classifier, read by one consumer: the trigger below. '
  'Never rendered, never read by the app.';
comment on column items.classify_attempts is
  'Failed classification attempts. The sweep predicate excludes rows at or above the Worker''s '
  'ceiling, so a persistently failing item is set aside as an ordinary unclassified Inbox row '
  'rather than retried forever. A configuration fault (a missing or rejected API key) '
  'deliberately does NOT increment it.';

-- The sweeper is the only query that wants this set, so index exactly it — the same shape as
-- items_undispatched_idx from 0026.
create index items_unclassified_idx on items (created_at) where classified_at is null;

-- ── 2. A human touch claims the item ─────────────────────────────────────────
-- The owner's rule: editing any field the classifier writes means the item is yours, and the
-- sweeper never revisits it. Enforced BEFORE UPDATE (the function modifies NEW), and in the
-- database rather than the PATCH route for the same reason 0026 put inherit_dispatched_at
-- here: three ingresses already edit an item and only the database sits under all of them.
--
-- The three FK columns claim only in the NON-NULL direction, and that carve-out is
-- load-bearing. All three are `on delete set null`, so a referential cascade writes them with
-- no human stating anything — and deleting a folder is the case that bites: 0026's
-- return_folder_items_to_inbox deliberately sends that folder's items back to the Inbox, and
-- the same delete nulls their folder_id. A naive watch would claim every one of those rows on
-- its way back to the Inbox, permanently hiding from the sweeper exactly the items that most
-- need re-triaging. Excluding the to-null direction fixes it precisely; the only case it gives
-- up is a human hand-clearing a label on a never-classified item.
create or replace function claim_item_from_classifier() returns trigger
language plpgsql security invoker as $$
begin
  -- A non-null classified_at means either the classifier is stamping its own verdict in this
  -- very statement, or the row is already spoken for. Either way there is nothing to claim.
  if new.classified_at is null and (
       new.title     is distinct from old.title
    or new.notes     is distinct from old.notes
    or new.item_type is distinct from old.item_type
    or new.priority  is distinct from old.priority
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

create trigger items_claim_from_classifier
  before update on items
  for each row execute function claim_item_from_classifier();

-- ── 3. The correction log ────────────────────────────────────────────────────
-- Append-only, one row per corrected field. A table rather than columns on items for the same
-- reasons habit_entries is not on items (ALF-146): different cardinality (several corrections
-- per item), different lifetime (a lesson outlives its item), and exactly one reader.
create table classification_corrections (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid references items (id) on delete set null,
  captured_text  text not null,
  field          text not null,
  direction      text not null,
  guessed_value  text,
  chosen_value   text,
  provider       text not null,
  model          text not null,
  prompt_version int  not null,
  created_at     timestamptz not null default now(),

  constraint classification_corrections_field_valid check (
    field in ('item_type', 'priority', 'due_date',
              'folder_id', 'intended_project_id', 'intended_epic_id')
  ),
  constraint classification_corrections_direction_valid check (
    direction in ('changed', 'filled_in', 'blanked')
  )
);

comment on column classification_corrections.captured_text is
  'A FROZEN copy of the item''s title (and notes), denormalised on purpose. A correction is a '
  'historical fact — this text, at that moment, got that label — so referencing the item would '
  'lose the text when it is deleted and would pair a later-edited title with a label chosen for '
  'the old one, silently corrupting the example.';
comment on column classification_corrections.direction is
  'changed = the label was wrong; filled_in = the model left it blank and the owner did not '
  '(it could have known); blanked = the model filled it and the owner cleared it (it should '
  'have abstained — the most valuable of the three, since precision is what the prompt '
  'optimises for).';
comment on column classification_corrections.guessed_value is
  'The guess as text; ids are stored as ids and resolved to human names when the prompt is '
  'assembled, so an example naming a since-deleted folder simply fails to resolve and is '
  'dropped rather than taught. NULL = the model abstained on this field.';
comment on column classification_corrections.item_id is
  'on delete set null, so a lesson outlives its item — captured_text is what the example is '
  'made of, not this reference.';

create index classification_corrections_created_at_idx
  on classification_corrections (created_at desc);

-- RLS gates which rows; GRANTs gate whether the role may touch the table at all. Raw `psql -f`
-- gets none of Supabase's auto-grants, so both are explicit (see the supabase skill). The diff
-- trigger below is `security invoker`, so the INSERT runs as whoever dispatched — including the
-- `authenticated` role a browser dispatch uses, which is why it needs insert here.
alter table classification_corrections enable row level security;

create policy "authenticated full access" on classification_corrections
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on classification_corrections
  to anon, authenticated, service_role;

-- ── 4. The dispatch-time diff ────────────────────────────────────────────────
-- Dispatch happens three ways — the bulk `{ dispatched: true }` PATCH, enter_code_module, and
-- convert_to_code_epic — and two of those are RPCs the route never sees. The transition of
-- dispatched_at away from null is the single choke point all three pass through, so the diff
-- lives there and no ingress can forget it.
--
-- At dispatch rather than on every edit: an edit mid-triage may be revised twice before you are
-- done, and logging each would teach the model your hesitation rather than your conclusion.
--
-- One known, accepted quirk: enter_code_module nulls due_date in the same statement that stamps
-- dispatched_at, so a task-shaped guess on an item sent to the factory logs a `blanked` due-date
-- correction. That is the correct lesson — the owner decided it was a code item, so the due date
-- was wrong — and needs no special case.
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

-- The WHEN clause is the whole gate: the first dispatch only, and only for an item a model
-- actually judged (a row claimed by a human edit has a null guess and teaches nothing).
create trigger items_log_classification_corrections
  after update on items
  for each row
  when (old.dispatched_at is null
        and new.dispatched_at is not null
        and old.classified_guess is not null)
  execute function log_classification_corrections();

-- ── 5. Re-expand the task_items view ─────────────────────────────────────────
-- MANDATORY. `select i.*` freezes its column list at CREATE time, so the six columns above are
-- invisible to the read path until the view is recreated — the bug 0011, 0013 and 0026 all
-- document. getAllItems() reads this view with .overrideTypes<Item[]>(), and Item is the TABLE
-- row type, so a column on the table but not the view yields `undefined` where the type promises
-- `string | null`. Invisibility is the UI's job (nothing renders these), not the view's.
-- `create or replace` (no drop), so the grants and security_invoker survive.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

notify pgrst, 'reload schema';
