---
branch: feat/code-module-m1-schema
---

# Software Factory schema & contract (M1)

*2026-06-15T03:55:36.357Z*

Migration `0002_software_factory.sql` adds the Project / Epic / Story model behind the `code` item type: new enums, the `projects`/`epics`/`code_items` tables, atomic ref-allocation RPCs, the `task_items` and `v_code_stories` views, and a CHECK constraint that makes completion/due-dates/subtasks task-only. Evidence below runs against the live DB (it reads `DATABASE_URL` from `frontend/.env.local`); all mutation is wrapped in `begin … rollback` so nothing persists.

**New enums and tables exist.** The factory states, the lane enum, and the three sidecar tables are present after the migration.

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' frontend/.env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select 'factory_state: ' || string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='code_factory_state';"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select 'lane: ' || string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='code_lane';"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select 'tables: ' || string_agg(table_name, ', ' order by table_name) from information_schema.tables where table_schema='public' and table_name in ('projects','epics','code_items');"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select 'views: ' || string_agg(table_name, ', ' order by table_name) from information_schema.views where table_schema='public' and table_name in ('task_items','v_code_stories');"
```

```output
factory_state: needs_refinement, in_refinement, ready_for_dev, in_development, ready_for_review, done, blocked, abandoned
lane: human, local
tables: code_items, epics, projects
views: task_items, v_code_stories
```

**Refs are server-allocated from one shared per-project counter** (epics AND stories). `create_epic` then two `enter_code_module` calls draw `DMO-1`, `DMO-2`, `DMO-3` with no collision; `enter_code_module` also flips `item_type` to `code` and clears task-only fields. All inside a rolled-back transaction.

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' frontend/.env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
begin;
insert into projects (id, name, key, repo_owner, repo_name)
  values ('cccccccc-0000-0000-0000-0000000000d0', 'Demo', 'DMO', 'ac3charland', 'demo-repo');
insert into items (id, title, item_type) values
  ('dddddddd-0000-0000-0000-0000000000d1', 'Demo story one', 'task'),
  ('dddddddd-0000-0000-0000-0000000000d2', 'Demo story two', 'unclassified');
select 'epic       -> ' || (create_epic('cccccccc-0000-0000-0000-0000000000d0', 'Demo epic')).ref;
select 'story one  -> ' || (enter_code_module('dddddddd-0000-0000-0000-0000000000d1',
  'cccccccc-0000-0000-0000-0000000000d0',
  (select id from epics where project_id='cccccccc-0000-0000-0000-0000000000d0'))).ref;
select 'story two  -> ' || (enter_code_module('dddddddd-0000-0000-0000-0000000000d2',
  'cccccccc-0000-0000-0000-0000000000d0',
  (select id from epics where project_id='cccccccc-0000-0000-0000-0000000000d0'))).ref;
select 'item ' || id || ' is now ' || item_type || ' (due_date=' || coalesce(due_date::text,'null') || ')'
  from items where id in ('dddddddd-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d2') order by id;
rollback;
SQL
```

```output
BEGIN
INSERT 0 1
INSERT 0 2
epic       -> DMO-1
story one  -> DMO-2
story two  -> DMO-3
item dddddddd-0000-0000-0000-0000000000d1 is now code (due_date=null)
item dddddddd-0000-0000-0000-0000000000d2 is now code (due_date=null)
ROLLBACK
```

**Task-gating is enforced in the schema.** A factory item is excluded from the `task_items` read path (so it leaves Tasks/Inbox), and the `items_task_only_fields` CHECK rejects a due date / parent / completed status on any non-`task` item.

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' frontend/.env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
# task_items excludes a factory item (transaction rolled back)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
begin;
insert into projects (id, name, key, repo_owner, repo_name)
  values ('cccccccc-0000-0000-0000-0000000000e0', 'Demo2', 'DM2', 'ac3charland', 'demo-repo-2');
insert into items (id, title, item_type) values ('dddddddd-0000-0000-0000-0000000000e1', 'Gated story', 'task');
select 'entered factory as ' || (enter_code_module('dddddddd-0000-0000-0000-0000000000e1',
  'cccccccc-0000-0000-0000-0000000000e0',
  (create_epic('cccccccc-0000-0000-0000-0000000000e0','E')).id)).ref;
select 'still visible in task_items? ' || exists(select 1 from task_items where id='dddddddd-0000-0000-0000-0000000000e1')::text;
rollback;
SQL
# CHECK constraint rejects task fields on a non-task item (single statement self-rolls-back on error)
psql "$DATABASE_URL" -c "insert into items (title, item_type, due_date) values ('illegal', 'code', now());" 2>&1 \
  | grep -oE 'violates check constraint "items_task_only_fields"'
```

```output
BEGIN
INSERT 0 1
INSERT 0 1
entered factory as DM2-2
still visible in task_items? false
ROLLBACK
violates check constraint "items_task_only_fields"
```
