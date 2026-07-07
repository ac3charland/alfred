-- 0013_intended_project.sql — ALF-62: a code-classified INBOX item may carry an intended project.
--
-- A code-classified inbox item (item_type = 'code' with no code_items sidecar) has nowhere to
-- record a project today: code_items.project_id only exists once the item enters the factory. The
-- prefix flow ("ALF: ship dark mode") needs a lightweight, epic-free association on items itself,
-- so add a nullable intended_project_id. code_items.project_id stays authoritative once the item
-- enters the factory; this is only the pre-factory Inbox hint.
alter table items
  add column intended_project_id uuid references projects (id) on delete set null;

-- on delete set null: deleting a project must not orphan or break Inbox rows — the item simply
-- loses its hint and stays a plain code item.

-- Only a code item may hold an intended project (keeps unclassified/task rows clean).
alter table items add constraint items_intended_project_code_only check (
  intended_project_id is null or item_type = 'code'
);

create index items_intended_project_id_idx on items (intended_project_id);

-- A `select i.*` view freezes its column list at CREATE time (see 0011), so a column added to
-- items afterwards never appears in the view until it is recreated. getAllItems() reads task_items,
-- so recreate it here to surface intended_project_id. No drop, so the existing grants and
-- security_invoker survive; the leading columns are unchanged and the new one lands at the end.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);
