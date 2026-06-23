-- Alfred — Global story priority for the cross-project Backlog (ALF-35).
--
-- Adds a single global total order across all code stories so the Backlog
-- can rank them and the project board can reflect that order. Three parts:
--   1. priority column + sequence on code_items
--   2. Atomic swap RPC (swap_code_priority) for the chevron reorder
--   3. v_code_stories recreated with priority appended

-- ── 1. Global priority sequence + column ─────────────────────────────────────
-- A global story-priority order for the cross-project Backlog (ALF-35).
-- Lower = higher priority. One sequence (NOT the per-project ref counter) because the
-- Backlog ranks every story across every project in a single list. New stories append to
-- the bottom (largest priority) until the owner ranks them up.
create sequence code_priority_seq;

alter table code_items
  add column priority bigint not null default nextval('code_priority_seq');

comment on column code_items.priority is
  'Global cross-project Backlog rank (ALF-35). Lower = higher priority. Allocated from '
  'code_priority_seq; reordered by swap_code_priority(). Distinct across all stories.';

-- Seed priority from existing creation order (ref_number) — a stable starting rank.
with ranked as (
  select item_id, row_number() over (order by ref_number) as rn from code_items
)
update code_items c set priority = ranked.rn from ranked where ranked.item_id = c.item_id;

-- Park the sequence above every backfilled value so appends land at the bottom.
select setval('code_priority_seq', coalesce((select max(priority) from code_items), 0) + 1, false);

create unique index code_items_priority_key on code_items (priority);

-- ── 2. Atomic swap RPC ────────────────────────────────────────────────────────
-- Swap the global priority of two stories (the Backlog chevron reorder). One UPDATE so the
-- unique(priority) index never sees a duplicate mid-swap. Returns both updated rows.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri bigint; b_pri bigint;
begin
  select priority into a_pri from code_items where ref = p_a;
  select priority into b_pri from code_items where ref = p_b;
  if a_pri is null or b_pri is null then
    raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
  end if;
  return query
    update code_items
       set priority = case ref when p_a then b_pri when p_b then a_pri else priority end
     where ref in (p_a, p_b)
    returning *;
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

-- ── 3. Expose priority on the board view ─────────────────────────────────────
-- create or replace view only allows APPENDING columns, so priority goes at the end.
create or replace view v_code_stories with (security_invoker = true) as
  select
    c.item_id, c.project_id, c.epic_id, c.ref_number, c.ref, c.factory_state, c.lane,
    c.spec_path, c.spec_sha, c.spec_markdown, c.refinement_pr_url, c.implementation_pr_url,
    c.blocked_reason, c.created_at as code_created_at, c.updated_at as code_updated_at,
    i.title, i.notes, i.source_url, i.created_at as item_created_at,
    p.key as project_key, p.name as project_name, p.repo_owner, p.repo_name,
    e.name as epic_name, e.ref as epic_ref, e.archived_at as epic_archived_at,
    c.priority                              -- ← ALF-35: appended for Backlog ordering
  from code_items c
  join items i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics e on e.id = c.epic_id;
