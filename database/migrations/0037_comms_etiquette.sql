-- ═══════════════════════════════════════════════════════════════════════════
-- 0037 — Comms etiquette: thread context for the classifier, and one canonical handle form
--
-- Two unrelated-looking changes that are the same bug seen twice: the classifier could not tell
-- whether a personal text owed a reply, because it was shown neither the conversation the text
-- sits in nor the name of the person who sent it.
--
--   1. `comm_thread_context` — the prior messages of a thread, read for a whole sweep tick in one
--      call. Etiquette is positional (who spoke last, whether the owner ever answered) and none of
--      that was in the model's input.
--   2. A rewrite of `comm_handles.handle` into the daemon's E.164 form, so a person the owner
--      added by typing `555-010-2233` resolves the sender who arrives as `+15550102233`. Until
--      now it did not, which is why adding someone to the people list appeared to do nothing.
--
-- No column is added anywhere and `comm_messages` is untouched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. comm_thread_context — the exchange a message arrived into ────────────
-- One call per sweep tick rather than one per message, and the Workers subrequest budget is the
-- reason: a tick already spends ~41 of the free plan's 50, and a per-message query would take it
-- to ~47 — close enough that a tick would start throwing part-way through, having billed model
-- calls for verdicts it never managed to store. A window function does the whole batch in one.
--
-- `security invoker` and the three-role grant match every other function in 0034: the Worker
-- calls this with the service-role key, and the browser never calls it at all, but a function
-- that ran as its definer would be a privilege the rest of the module does not take.
--
-- Rows come back NEWEST first within each message's group — that is what the rank is on, and
-- taking the most recent N is the whole point. The caller reverses each group so the transcript
-- reads in the direction the conversation happened.
create or replace function comm_thread_context(
  p_message_ids uuid[],
  p_limit       int      default 6,
  p_max_age     interval default '30 days'
)
returns table (
  for_message_id  uuid,
  direction       text,
  sender_name     text,
  sender_handle   text,
  body            text,
  body_extracted  boolean,
  has_attachments boolean,
  received_at     timestamptz
)
language sql
security invoker
stable
as $$
  select
    ranked.for_message_id,
    ranked.direction,
    ranked.sender_name,
    ranked.sender_handle,
    ranked.body,
    ranked.body_extracted,
    ranked.has_attachments,
    ranked.received_at
  from (
    select
      target.id as for_message_id,
      prior.direction,
      prior.sender_name,
      prior.sender_handle,
      prior.body,
      prior.body_extracted,
      prior.has_attachments,
      prior.received_at,
      row_number() over (
        partition by target.id
        order by prior.received_at desc, prior.id desc
      ) as rank
    from comm_messages target
    join comm_messages prior
      on prior.account_id = target.account_id
     and prior.thread_key = target.thread_key
     and prior.id <> target.id
     -- Strictly BEFORE the message being judged: a row that arrived after it is not context the
     -- sender could have been answering, and on a re-run it would be the future leaking backwards.
     and prior.received_at < target.received_at
     and prior.received_at >= target.received_at - p_max_age
    where target.id = any (p_message_ids)
  ) ranked
  where ranked.rank <= p_limit
  order by ranked.for_message_id, ranked.received_at desc;
$$;

grant execute on function comm_thread_context(uuid[], int, interval)
  to anon, authenticated, service_role;

-- ── 2. One canonical handle form ────────────────────────────────────────────
-- The daemon canonicalises every iMessage sender to E.164 before it reaches the database; the UI
-- stored whatever the owner typed. Compared as digits, `+15550102233` and `5550102233` are two
-- different strings, so a roster entry silently failed to resolve its own sender — the reported
-- "adding contacts to People seems to make no difference".
--
-- The repair is at comparison time (the Worker now canonicalises both sides), so this rewrite is
-- cleanup rather than the fix: it makes the stored data honest and gives the unique constraint
-- its meaning back. If it had to be dropped, matching would still work.
--
-- `handle` is unique, so the rewrite is collision-safe in both directions:
--   - the canonical form is already stored against the SAME person  → the row is redundant, delete it;
--   - the canonical form is already stored against a DIFFERENT person → leave the row alone. Two
--     people cannot share a handle, and rewriting would either fail this migration or silently
--     move a handle from one person to another. Leaving it keeps the status quo for that one row,
--     and comparison-time canonicalisation means it still resolves.
--   - otherwise → update in place.
do $$
declare
  v_row   record;
  v_canon text;
begin
  for v_row in
    select id, person_id, handle from comm_handles where handle not like '%@%'
  loop
    v_canon := regexp_replace(v_row.handle, '[^0-9]', '', 'g');

    if v_canon = '' then
      v_canon := lower(btrim(v_row.handle));
    elsif btrim(v_row.handle) like '+%' then
      v_canon := '+' || v_canon;
    elsif length(v_canon) = 10 then
      v_canon := '+1' || v_canon;
    elsif length(v_canon) = 11 and left(v_canon, 1) = '1' then
      v_canon := '+' || v_canon;
    end if;

    continue when v_canon = v_row.handle;

    if exists (
      select 1 from comm_handles other
      where other.handle = v_canon and other.person_id = v_row.person_id
    ) then
      delete from comm_handles where id = v_row.id;
    elsif not exists (select 1 from comm_handles other where other.handle = v_canon) then
      update comm_handles set handle = v_canon where id = v_row.id;
    end if;
  end loop;
end $$;

comment on column comm_handles.handle is
  'A lower-cased email address, or a phone number in E.164 — one canonical spelling per address,
   so a sender resolves whichever source it arrived from. The country code is inferred for a bare
   10-digit number (and for 11 digits starting 1); anything else keeps its digits unreshaped. The
   same rule lives in daemon/src/sources/imessage/normalize.ts (the reference),
   frontend/lib/comms/people.ts (what gets stored) and workers/src/comms/prompt.ts (what the
   classifier compares).';
