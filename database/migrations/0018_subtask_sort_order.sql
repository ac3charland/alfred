-- Alfred — manual subtask ordering (ALF-117).
--
-- A parent's subtasks had no user-controllable order: buildTree sorted every subtask group by
-- created_at (oldest-first) and the Folder view re-ranked them by priority. This adds a single
-- fractional rank so a subtask can be dragged into the gap between two siblings and stay there,
-- in every view, across reloads.
--
-- Fractional (double precision) so one reorder inserts at the MIDPOINT of two neighbours — one
-- row UPDATE, never a renumber of the list (the same technique code_items.priority uses since
-- 0005/0014). Lower = earlier (top of the sibling group).
--
-- No global unique index (unlike code_items.priority): ordering is scoped PER PARENT, so global
-- collisions are harmless and no atomic-swap RPC is needed. A brand-new subtask gets the next
-- (largest) sequence value → it appends at the bottom of its sibling group with no route change.

create sequence item_sort_order_seq;

alter table items
  add column sort_order double precision not null default nextval('item_sort_order_seq');

comment on column items.sort_order is
  'Manual sibling order for subtasks (ALF-117). Lower = earlier. Only meaningful WITHIN a '
  'parent_id group; roots ignore it (Inbox=created_at desc, Folder=priority). Fractional: a '
  'reorder inserts at the midpoint of two neighbours so no sibling is renumbered.';

-- Preserve today's order: seed from created_at so existing subtasks keep their chronological
-- (oldest-first) sequence. Only the RELATIVE order within each parent matters, so a global
-- row_number is sufficient.
with ranked as (
  select id, row_number() over (order by created_at) as rn from items
)
update items i set sort_order = ranked.rn from ranked where ranked.id = i.id;

-- Park the sequence above every backfilled value so fresh inserts land at the bottom.
select setval('item_sort_order_seq',
              coalesce((select max(sort_order) from items), 0)::bigint + 1, false);

-- security_invoker inserts run the column default's nextval() as `authenticated`, which needs
-- USAGE on the sequence (see 0008 — the bug code_priority_seq hit). Grant it.
grant usage on sequence item_sort_order_seq to anon, authenticated, service_role;

-- task_items is `select i.*`; PostgreSQL freezes the column list at CREATE, so recreate the view
-- to re-expand it and surface sort_order (the 0011 freeze gotcha).
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);
