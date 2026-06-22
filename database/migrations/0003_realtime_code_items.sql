-- Story swimlanes update live: stream code_items row changes to the open Code board.
-- factory_state is written out-of-band by the webhook Worker, so the browser needs a
-- push channel to reflect PR-driven transitions without a reload.
--
-- Realtime delivers nothing until a table joins the supabase_realtime publication. RLS
-- still governs the stream: code_items already has the `authenticated full access` policy
-- (using (true)) from 0002, so an authenticated browser (anon key + session) receives
-- changes; no new policy and no database.types.ts regeneration are required.
alter publication supabase_realtime add table code_items;
