-- Alfred — manual folder ordering (ALF-153).
--
-- The sidebar folder list had no user-controllable order: every reader sorted it by
-- created_at (oldest-first), so the only way to move a folder was to delete and recreate it.
-- This adds a single fractional rank so a folder can be dragged into the gap between two
-- others (or nudged with the row menu) and stay there across reloads.
--
-- Fractional (double precision) so one reorder inserts at the MIDPOINT of two neighbours — one
-- row UPDATE, never a renumber of the list. The same technique items.sort_order uses since 0018;
-- lower = earlier (top of the list).
--
-- No unique index: a collision only makes two folders tie, which the readers break stably by
-- their seeded order. A brand-new folder gets the next (largest) sequence value → it appends at
-- the bottom of the list with no route change.

create sequence folder_sort_order_seq;

alter table folders
  add column sort_order double precision not null default nextval('folder_sort_order_seq');

comment on column folders.sort_order is
  'Manual sidebar order for the folder list (ALF-153). Lower = earlier. Fractional: a reorder '
  'inserts at the midpoint of two neighbours so no other folder is renumbered.';

-- Preserve today's order: seed from created_at so existing folders keep their chronological
-- (oldest-first) sequence. Only the RELATIVE order matters, so row_number is sufficient.
with ranked as (
  select id, row_number() over (order by created_at) as rn from folders
)
update folders f set sort_order = ranked.rn from ranked where ranked.id = f.id;

-- Park the sequence above every backfilled value so fresh inserts land at the bottom.
select setval('folder_sort_order_seq',
              coalesce((select max(sort_order) from folders), 0)::bigint + 1, false);

-- Inserts run the column default's nextval() as `authenticated`, which needs USAGE on the
-- sequence (see 0008 — the bug code_priority_seq hit). Grant it.
grant usage on sequence folder_sort_order_seq to anon, authenticated, service_role;
