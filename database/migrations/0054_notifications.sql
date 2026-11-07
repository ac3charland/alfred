-- Alfred — outbound pings to the owner's phone via Telegram (ALF-333).
--
-- Two things ping: a comms message the model has just judged ASAP, and a timed task whose due
-- minute has just arrived. The Worker's one-minute notify tick calls `claim_notifications`, sends
-- each claim it gets back, and stamps the outcome on the claim row.
--
-- Two pieces:
--   1. `notifications` — one row per ping: the cross-tick dedupe, the retry state, and the only
--      record of what alfred sent (the Bot API cannot read a bot's own messages back).
--   2. `claim_notifications` — eligibility and the claim in one call, so a tick costs one
--      subrequest to learn everything it has to send.

-- ── 1. notifications ─────────────────────────────────────────────────────────
create table notifications (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('comms_asap', 'task_due')),
  fire_key            text not null,
  comm_message_id     uuid references comm_messages (id) on delete cascade,
  item_id             uuid references items (id) on delete cascade,
  claimed_at          timestamptz not null default now(),
  sent_at             timestamptz,
  telegram_message_id bigint,
  text                text,
  attempts            int not null default 0,
  last_error          text,
  abandoned_at        timestamptz,

  constraint notifications_subject check (
    (kind = 'comms_asap' and comm_message_id is not null and item_id is null) or
    (kind = 'task_due'   and item_id is not null and comm_message_id is null))
);

comment on column notifications.fire_key is
  'What one ping is about, unique per kind: the message id for comms_asap (so a message pings at
   most once, however often it is re-judged ASAP), and item_id|YYYY-MM-DD|HH:MM for task_due (so
   rescheduling a task changes its key and re-arms it).';

comment on column notifications.text is
  'The text actually sent, as Telegram received it. NULL until sent.';

comment on column notifications.abandoned_at is
  'When the claim was given up on: three failed attempts, an hour since it was claimed, or a
   subject that stopped being eligible (the task was completed or moved, the message retiered
   or cleared). An abandoned claim is never sent.';

-- The referee for overlapping ticks: two claims for one ping cannot both insert.
create unique index notifications_key_idx on notifications (kind, fire_key);
create index notifications_pending_idx on notifications (claimed_at)
  where sent_at is null and abandoned_at is null;

-- The cascades delete by these columns, so they are indexed.
create index notifications_comm_message_idx on notifications (comm_message_id);
create index notifications_item_idx on notifications (item_id);

-- Single-user: the authenticated owner gets full access; anon is denied (no policy). Explicit
-- grants because raw `psql -f` does not get Supabase's auto-grants. The primary key is
-- `gen_random_uuid()`, so there is no sequence to grant.
alter table notifications enable row level security;
create policy "authenticated full access" on notifications
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on notifications to anon, authenticated, service_role;

-- ── 2. claim_notifications ───────────────────────────────────────────────────
-- A ping means "this just became true", so a new claim needs all of:
--
--   comms_asap — an inbound, uncleared message the MODEL put in ASAP (an owner's own retier is
--     something they already know), whose current verdict was written in the last 30 minutes.
--     Without the window the first deploy would ping every ASAP row still open. The clock starts
--     at the verdict, not the message, so a message the Mac daemon delivers hours late still
--     pings: that is when the owner most needs to hear.
--   task_due — an active, timed task whose due moment falls in (p_now - 15 min, p_now]. The
--     moment is the floating date + time read in `p_zone`; the window keeps deploy day, a task
--     created with a time already past, and the catch-up after an outage from replaying a
--     backlog as a burst.
--
-- An unsent claim is re-returned while it has fewer than 3 attempts, is under an hour old, and
-- its subject is still eligible — the task still active at the same date and time, the message
-- still ASAP and uncleared. Otherwise it is abandoned. Retries are not held to the windows above:
-- a systemic outage fixed within the hour still delivers.
--
-- Returns the retries first (oldest claim first), then the new claims in the order their moments
-- arrived, at most p_limit rows; anything past the limit waits for the next tick.
create function claim_notifications(p_now timestamptz, p_zone text, p_limit int)
returns table (
  id        uuid,
  kind      text,
  attempts  int,
  sender    text,
  account   text,
  ask       text,
  title     text,
  due_time  time
)
language plpgsql
security invoker
as $$
-- The output columns share names with notifications' own (id, kind, attempts, due_time); every
-- reference here is to a table column.
#variable_conflict use_column
declare
  v_retries uuid[];
  v_asap    uuid[];
  v_due     uuid[];
begin
  if p_zone is null or p_zone = '' then
    raise exception 'claim_notifications: p_zone is required';
  end if;
  -- Rejects an unknown zone before anything is written, rather than mid-insert.
  perform p_now at time zone p_zone;

  -- 1. Abandon the unsent claims that fail the retry test.
  update notifications n
     set abandoned_at = p_now
   where n.sent_at is null
     and n.abandoned_at is null
     and (
          n.attempts >= 3
       or n.claimed_at <= p_now - interval '60 minutes'
       or (n.kind = 'task_due' and not exists (
             select 1 from task_items t
              where t.id = n.item_id
                and t.status = 'active'
                and t.due_time is not null
                and n.fire_key = t.id::text
                      || '|' || to_char((t.due_date at time zone 'UTC')::date, 'YYYY-MM-DD')
                      || '|' || to_char(t.due_time, 'HH24:MI')))
       or (n.kind = 'comms_asap' and not exists (
             select 1 from comm_messages m
              where m.id = n.comm_message_id
                and m.tier = 'asap'
                and m.cleared_at is null))
     );

  -- What survives is retryable. Read before the insert, so the new claims are not counted twice.
  select coalesce(array_agg(n.id), '{}')
    into v_retries
    from notifications n
   where n.sent_at is null and n.abandoned_at is null;

  -- 2. Claim what just became true. The unique index arbitrates overlapping ticks.
  with claimed as (
    insert into notifications (kind, fire_key, comm_message_id, claimed_at)
    select 'comms_asap', m.id::text, m.id, p_now
      from comm_messages m
      join comm_verdicts v on v.id = m.verdict_id
     where m.direction = 'inbound'
       and m.tier = 'asap'
       and m.judged_by = 'model'
       and m.cleared_at is null
       and v.created_at > p_now - interval '30 minutes'
    on conflict (kind, fire_key) do nothing
    returning notifications.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_asap from claimed;

  with claimed as (
    insert into notifications (kind, fire_key, item_id, claimed_at)
    select 'task_due', d.fire_key, d.item_id, p_now
      from (
        select t.id as item_id,
               t.id::text
                 || '|' || to_char((t.due_date at time zone 'UTC')::date, 'YYYY-MM-DD')
                 || '|' || to_char(t.due_time, 'HH24:MI') as fire_key,
               ((t.due_date at time zone 'UTC')::date + t.due_time) at time zone p_zone as due_at
          from task_items t
         where t.status = 'active'
           and t.due_date is not null
           and t.due_time is not null
      ) d
     where d.due_at > p_now - interval '15 minutes'
       and d.due_at <= p_now
    on conflict (kind, fire_key) do nothing
    returning notifications.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_due from claimed;

  -- 3. Hand back everything the Worker needs to build each message: the retries and this call's
  --    own claims only. A claim another tick committed after the retry read is that tick's to send.
  return query
  select n.id,
         n.kind,
         n.attempts,
         coalesce(p.name, m.sender_name, m.sender_handle) as sender,
         a.label as account,
         v.ask,
         t.title,
         t.due_time
    from notifications n
    left join comm_messages m on m.id = n.comm_message_id
    left join comm_verdicts v on v.id = m.verdict_id
    left join comm_people   p on p.id = v.person_id
    left join comm_accounts a on a.id = m.account_id
    left join task_items    t on t.id = n.item_id
   where n.id = any (v_retries || v_asap || v_due)
   order by (n.id = any (v_retries)) desc,
            case when n.id = any (v_retries) then n.claimed_at end,
            coalesce(v.created_at,
                     ((t.due_date at time zone 'UTC')::date + t.due_time) at time zone p_zone),
            n.id
   limit p_limit;
end;
$$;

grant execute on function claim_notifications(timestamptz, text, int)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
