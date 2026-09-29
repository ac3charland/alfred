-- alfred — `research` as a fifth item type (ALF-298).
--
-- A research item is an open question the owner wants answered from outside sources and written
-- up: Dispatch hands it to a Claude Code Routine that researches it on the web, and the report
-- lands in the Reader as a post (0043 holds the rest of that).
--
-- Alone in its own file on purpose. deploy.ts and gen-types.ts apply each migration file in one
-- transaction, and Postgres refuses to USE an enum value inside the transaction that added it
-- ("unsafe use of new value"). Everything that names 'research' — the dispatched-row CHECK, the
-- dispatch RPC — therefore lives in the next migration, which runs in a transaction of its own.
alter type item_type add value if not exists 'research';

-- PostgREST caches the schema; the new enum value is invisible to it until it reloads.
notify pgrst, 'reload schema';
