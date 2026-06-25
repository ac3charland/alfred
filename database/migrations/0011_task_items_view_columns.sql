-- 0011_task_items_view_columns.sql — surface late-added `items` columns on the task_items view.
--
-- BUG: /priority, /folders/:id, /completed, and the inbox list all 500'd with
--   Cannot destructure property 'label' of priorityOption(...) as it is undefined
-- because every task came back from the read layer with `priority` = undefined.
--
-- WHY: `task_items` (0002) is `select i.* from items i where ...`. PostgreSQL freezes a view's
-- `select *` column list at CREATE time — columns ADDed to `items` afterwards never appear in the
-- view. So `recurrence` / `recurrence_series_id` / `occurrence_index` (0006) and `priority` (0010)
-- were all absent from the view that getAllItems() selects (`from('task_items').select('*')`). A row
-- read without a `priority` key is `undefined`, which slips past the `!== null` chip guard and
-- destructures an option that isn't there. (0005 hit the same freeze on the board view and noted it:
-- "create or replace view only allows APPENDING columns".)
--
-- FIX: recreate the view so `select i.*` re-expands to the CURRENT column set. Every missing column
-- was APPENDED to `items` (none dropped/renamed), so the leading columns are unchanged and the new
-- ones land at the end — exactly what `create or replace view` permits. No drop, so the existing
-- grants and `security_invoker` survive. Idempotent and safe to re-run on the live database.
create or replace view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);
