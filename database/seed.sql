-- alfred — tiny development seed (Phase 1).
-- Safe to run once on a fresh DB. Demonstrates: folders, Inbox items, an
-- unclassified capture, and a 3-level subtask tree (arbitrary depth).

insert into folders (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Work'),
  ('22222222-2222-2222-2222-222222222222', 'Home');

-- Inbox items (folder_id null) — a task plus a raw unclassified capture
insert into items (id, title, item_type, status, raw_capture) values
  ('a0000000-0000-0000-0000-000000000001', 'Buy oat milk', 'task', 'active', 'buy oat milk'),
  ('a0000000-0000-0000-0000-000000000002', 'Read article on recursive CTEs', 'unclassified', 'active',
   'remember to read that article about recursive ctes in postgres');

-- A filed task with a nested subtask tree (3 levels deep)
insert into items (id, title, item_type, status, folder_id) values
  ('b0000000-0000-0000-0000-000000000001', 'Ship alfred MVP', 'task', 'active',
   '11111111-1111-1111-1111-111111111111');

insert into items (id, title, item_type, status, folder_id, parent_id, due_date) values
  ('b0000000-0000-0000-0000-000000000002', 'Finish data layer', 'task', 'active',
   '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001',
   now() + interval '2 days');

insert into items (id, title, item_type, status, folder_id, parent_id, completed_at) values
  ('b0000000-0000-0000-0000-000000000003', 'Write migration SQL', 'task', 'completed',
   '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', now());
