-- 0010_task_priority.sql — ALF-37: discrete task priority

-- ── Priority enum (declaration order IS the rank: high < medium < low) ──
create type task_priority as enum ('high', 'medium', 'low');

-- ── Add a nullable priority column to items (null = no priority set) ──
alter table items
  add column priority task_priority;

comment on column items.priority is
  'Discrete task priority (ALF-37). null = unprioritised. Task-only field; '
  'sorted high→medium→low with due_date as the tiebreaker in the By-Priority view.';

-- Index the sort/filter path.
create index items_priority_idx on items (priority);

-- ── Keep priority task-only, consistent with items_task_only_fields ──
alter table items drop constraint items_task_only_fields;
alter table items add constraint items_task_only_fields check (
  item_type = 'task'
  or (due_date is null and parent_id is null
      and status = 'active' and completed_at is null
      and priority is null)
);
