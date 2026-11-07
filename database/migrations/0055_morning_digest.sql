-- Alfred — the 7 AM morning digest over Telegram (ALF-343).
--
-- One message a day: what is due, the comms queue, and the reader's waiting count, under a short
-- model-written opener. It rides the existing one-minute notify tick (the account has no cron
-- trigger left), so it is a third kind of notification rather than a new schedule.
--
-- Three pieces:
--   1. `notifications` accepts `morning_digest`, a kind with no subject row.
--   2. `claim_notifications` gains `p_digest_time` and claims one digest per local date.
--   3. `digest_facts` — every fact the digest renders, in one read.

-- ── 1. A third kind, with no subject row ──────────────────────────────────────
-- `notifications_kind_check` is the name Postgres generated for 0054's inline column check.
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('comms_asap', 'task_due', 'morning_digest'));

alter table notifications drop constraint notifications_subject;
alter table notifications add constraint notifications_subject check (
  (kind = 'comms_asap'     and comm_message_id is not null and item_id is null) or
  (kind = 'task_due'       and item_id is not null and comm_message_id is null) or
  (kind = 'morning_digest' and item_id is null and comm_message_id is null));

comment on column notifications.fire_key is
  'What one ping is about, unique per kind: the message id for comms_asap (so a message pings at
   most once, however often it is re-judged ASAP), item_id|YYYY-MM-DD|HH:MM for task_due (so
   rescheduling a task changes its key and re-arms it), and the local YYYY-MM-DD for
   morning_digest (so a day gets one digest, however many ticks overlap).';

-- ── 2. claim_notifications, now with the digest ──────────────────────────────
-- Everything 0054 says about the two subject kinds still holds; the function body is 0054's with
-- the digest added. The new rule:
--
--   morning_digest — claimed while the local time in `p_zone` is in
--     [p_digest_time, p_digest_time + 60 min), keyed on the local date. A deploy after the window
--     therefore starts tomorrow, and an outage that ends inside the window still delivers. The
--     window does not wrap past midnight: a digest time after 23:00 has a short window. NULL
--     `p_digest_time` means the digest is off and nothing new is claimed.
--
-- A digest claim has no subject to go stale, so only the shared rules abandon it: three
-- attempts, or an hour since it was claimed. Abandoned or sent, its row keeps the date's key, so
-- the date never gets a second digest.
--
-- `p_digest_time` defaults to NULL so a Worker still calling with three arguments keeps working
-- (digest off) between this migration applying and the new Worker deploying. The 3-argument
-- function is dropped first: two overloads would make that call ambiguous.
drop function claim_notifications(timestamptz, text, int);

create function claim_notifications(
  p_now         timestamptz,
  p_zone        text,
  p_limit       int,
  p_digest_time time default null
)
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
  v_digest  uuid[];
  v_local   timestamp;
begin
  if p_zone is null or p_zone = '' then
    raise exception 'claim_notifications: p_zone is required';
  end if;
  -- Rejects an unknown zone before anything is written, rather than mid-insert.
  v_local := p_now at time zone p_zone;

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

  -- What survives, and is not leased to a tick that may still be sending it, is retryable. Read
  -- before the insert, so the new claims are not counted twice.
  select coalesce(array_agg(n.id), '{}')
    into v_retries
    from notifications n
   where n.sent_at is null
     and n.abandoned_at is null
     and (n.leased_at is null or n.leased_at <= p_now - interval '5 minutes');

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

  -- Wall-clock arithmetic on the local timestamp, so a DST change elsewhere in the day neither
  -- skips nor repeats 07:00.
  with claimed as (
    insert into notifications (kind, fire_key, claimed_at)
    select 'morning_digest', to_char(v_local::date, 'YYYY-MM-DD'), p_now
     where p_digest_time is not null
       and v_local >= v_local::date + p_digest_time
       and v_local <  v_local::date + p_digest_time + interval '60 minutes'
    on conflict (kind, fire_key) do nothing
    returning notifications.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_digest from claimed;

  -- 3. Hand back everything the Worker needs to build each message: the retries and this call's
  --    own claims only (a claim another tick committed after the retry read is that tick's to
  --    send), and lease what is handed out. A digest row carries no subject fields — the Worker
  --    reads its facts separately — and orders by its local digest moment.
  return query
  with picked as (
    select n.id,
           n.kind,
           n.attempts,
           coalesce(p.name, m.sender_name, m.sender_handle) as sender,
           a.label as account,
           v.ask,
           t.title,
           t.due_time,
           row_number() over (
             order by (n.id = any (v_retries)) desc,
                      case when n.id = any (v_retries) then n.claimed_at end,
                      coalesce(v.created_at,
                               ((t.due_date at time zone 'UTC')::date + t.due_time)
                                 at time zone p_zone,
                               case when n.kind = 'morning_digest' then
                                 (to_date(n.fire_key, 'YYYY-MM-DD') + p_digest_time)
                                   at time zone p_zone end,
                               n.claimed_at),
                      n.id) as position
      from notifications n
      left join comm_messages m on m.id = n.comm_message_id
      left join comm_verdicts v on v.id = m.verdict_id
      left join comm_people   p on p.id = v.person_id
      left join comm_accounts a on a.id = m.account_id
      left join task_items    t on t.id = n.item_id
     where n.id = any (v_retries || v_asap || v_due || v_digest)
     order by position
     limit p_limit
  ), leased as (
    update notifications n set leased_at = p_now
      from picked where n.id = picked.id
  )
  select picked.id, picked.kind, picked.attempts, picked.sender, picked.account, picked.ask,
         picked.title, picked.due_time
    from picked
   order by picked.position;
end;
$$;

grant execute on function claim_notifications(timestamptz, text, int, time)
  to anon, authenticated, service_role;

-- ── 3. digest_facts ──────────────────────────────────────────────────────────
-- Every fact the digest renders, in one subrequest. The Worker ranks the tasks itself (it mirrors
-- the Today view's TypeScript rule); this only selects them.
--
--   tasks — every active task_items row, plus each non-active row that is the direct parent of
--     an active one. The Today view builds its tree from every row and drops a subtree below a
--     completed task; without that parent, its active subtask would surface as a root of its
--     own. Dates are floating (due_date is midnight UTC), so they are read in UTC.
--   comms — the response queue: inbound, uncleared, tiered asap/today/whenever. Unjudged rows
--     (tier NULL) and FYI are in neither the counts nor the asks. At most five asks, ASAP then
--     Today, each newest first; Whenever is a count only.
--   reader_waiting — the reading list's size: posts not archived.
--   plan — the newest weekly plan, verbatim. `p_now` does not filter it: whether it covers today
--     is read from the document itself.
--
-- `p_zone` is validated so a bad zone fails here as it does in claim_notifications; nothing here
-- depends on it otherwise. `p_now` is accepted for the same call shape and future use.
create function digest_facts(p_now timestamptz, p_zone text)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_result jsonb;
begin
  if p_zone is null or p_zone = '' then
    raise exception 'digest_facts: p_zone is required';
  end if;
  perform p_now at time zone p_zone;

  select jsonb_build_object(
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id,
               'parent_id', t.parent_id,
               'title', t.title,
               'status', t.status,
               'priority', t.priority,
               'due_date', to_char((t.due_date at time zone 'UTC')::date, 'YYYY-MM-DD'),
               'due_time', to_char(t.due_time, 'HH24:MI:SS'),
               'created_at', t.created_at)
             order by t.created_at desc, t.id), '[]'::jsonb)
        from task_items t
       where t.status = 'active'
          or exists (select 1 from task_items c
                      where c.parent_id = t.id and c.status = 'active')
    ),
    'comms', jsonb_build_object(
      'counts', (
        select jsonb_build_object(
                 'asap',     count(*) filter (where m.tier = 'asap'),
                 'today',    count(*) filter (where m.tier = 'today'),
                 'whenever', count(*) filter (where m.tier = 'whenever'))
          from comm_messages m
         where m.direction = 'inbound'
           and m.cleared_at is null
           and m.tier in ('asap', 'today', 'whenever')
      ),
      'asks', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'tier', q.tier,
                 'sender', q.sender,
                 'account', q.account,
                 'ask', q.ask,
                 'received_at', q.received_at) order by q.position), '[]'::jsonb)
          from (
            select m.tier,
                   coalesce(p.name, m.sender_name, m.sender_handle) as sender,
                   a.label as account,
                   v.ask,
                   m.received_at,
                   row_number() over (
                     order by case m.tier when 'asap' then 0 else 1 end,
                              m.received_at desc,
                              m.id) as position
              from comm_messages m
              left join comm_verdicts v on v.id = m.verdict_id
              left join comm_people   p on p.id = v.person_id
              left join comm_accounts a on a.id = m.account_id
             where m.direction = 'inbound'
               and m.cleared_at is null
               and m.tier in ('asap', 'today')
             order by position
             limit 5
          ) q
      )
    ),
    'reader_waiting', (select count(*) from reader_posts r where r.archived_at is null),
    'plan', (
      select jsonb_build_object('id', w.id, 'uploaded_at', w.uploaded_at, 'html', w.html)
        from weekly_plans w
       order by w.uploaded_at desc, w.id desc
       limit 1
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function digest_facts(timestamptz, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
