-- Alfred — a revision on every Backlog rank, so a tab can tell a fresh rank from a stale one (ALF-250).
--
-- An open Backlog hears a story's `priority` from two places: the reply to its own write, and the
-- Realtime stream, which carries every write to `code_items` — its own included, and on its own
-- schedule. A reply can land before or after its own echo, and an echo can trail the reply to a
-- LATER write. Comparing ranks can't order them: ranks repeat (a story swapped down and back holds
-- its old rank again). So every write that sets `priority` stamps `priority_rev` from one global
-- sequence, and the tab lands a rank only if its revision is newer than the last one it landed.
--
-- The stamp is a BEFORE row trigger, which fires once Postgres holds the row's lock, so for any one
-- story the revisions rise in the order its writes commit — whichever RPC, Worker, or respace
-- made them. Rows that predate this migration carry 0; every later write outranks them.
create sequence code_priority_rev_seq;

grant usage on sequence code_priority_rev_seq to anon, authenticated, service_role;

alter table code_items add column priority_rev bigint not null default 0;

comment on column code_items.priority_rev is
  'Revision of priority (ALF-250): stamped from code_priority_rev_seq on every insert and every '
  'update that sets priority, so a later write to a story always carries a higher revision.';

create or replace function stamp_code_priority_rev() returns trigger
language plpgsql as $$
begin
  new.priority_rev := nextval('code_priority_rev_seq');
  return new;
end; $$;

create trigger code_items_stamp_priority_rev
  before insert or update of priority on code_items
  for each row execute function stamp_code_priority_rev();

notify pgrst, 'reload schema';
