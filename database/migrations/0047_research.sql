-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — Research items become Reader posts (ALF-298).
--
-- A `research` item (the enum value 0046 added) is a question the owner wants researched on the
-- web and written up. Dispatching it consumes the Inbox row into a Reader post that waits for its
-- report: the app fires a Claude Code Routine per post, the Routine's session researches the
-- question and PUTs a markdown report back to the app, and from then on the post is summarised
-- and read like any other. This migration holds everything the database needs for that:
--
--   1. items_dispatched_needs_folder relaxed for research — a research row leaves the Inbox for
--      the Reader, never a folder, exactly like code and knowledge rows.
--   2. reader_posts gains a third source, `research`, and the columns that carry a research
--      post's lifecycle (queued → researching → done, or failed) beside the summary's own.
--   3. send_items_to_research — stamp dispatched_at (which fires the corrections log), insert one
--      queued post per item, then delete the items, all in one transaction.
--
-- reader_sweep_text is unchanged: a research post's body sweeps at ninety days like any post's,
-- and the summary, the brief and the session link stay.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A research row may be dispatched without a folder ─────────────────────
-- Recreated rather than altered — Postgres has no `alter constraint` for a CHECK.
alter table items drop constraint items_dispatched_needs_folder;
alter table items add constraint items_dispatched_needs_folder check (
  dispatched_at is null or folder_id is not null or item_type in ('code', 'knowledge', 'research')
);

-- ── 2. reader_posts — the research source and its lifecycle ──────────────────
alter table reader_posts drop constraint reader_posts_source_valid;
alter table reader_posts add constraint reader_posts_source_valid
  check (source in ('gmail', 'instapaper', 'research'));

comment on column reader_posts.source is
  'Where the post came from. gmail = a newsletter the tick read from the personal Gmail mirror;
   instapaper = an article the owner moved into the "To Reader" folder in Instapaper; research =
   a question dispatched from the Inbox, whose report a Claude Code Routine writes and delivers.
   Defaults to gmail, so every row that predates this column is a newsletter, which it is.';

alter table reader_posts
  add column research_brief        text,
  add column research_state        text,
  add column research_attempts     int not null default 0,
  add column research_fired_at     timestamptz,
  add column research_session_url  text,
  add column research_error        text,
  add column research_delivered_at timestamptz;

-- The research lifecycle is its own column rather than more summary_state values: the summary
-- states still mean exactly what they meant, and a delivered report walks them like any post.
alter table reader_posts add constraint reader_posts_research_state_valid
  check (research_state in ('queued', 'researching', 'done', 'failed'));

-- A research post always carries its brief and a state, and nothing else ever does. A done post
-- records when it was delivered. Deliberately NOT "done implies text is not null": the ninety-day
-- sweep nulls a done report's text like any post's.
alter table reader_posts add constraint reader_posts_research_shape check (
  (source = 'research') = (research_state is not null and research_brief is not null)
  and (research_state is distinct from 'done' or research_delivered_at is not null)
);

alter table reader_posts add constraint reader_posts_research_attempts_not_negative
  check (research_attempts >= 0);

-- The identity CHECK gains a third branch: a research post has none of the mail identity. Its
-- instapaper_bookmark_id stays free, because Send stamps the bookmark it saved there, exactly as
-- it does on a newsletter.
alter table reader_posts drop constraint reader_posts_source_identity;
alter table reader_posts add constraint reader_posts_source_identity check (
     (source = 'gmail'      and publication_id is not null and account_key is not null
                            and gmail_message_id is not null)
  or (source = 'instapaper' and instapaper_bookmark_id is not null
                            and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
  or (source = 'research'   and publication_id is null and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
);

comment on constraint reader_posts_source_identity on reader_posts is
  'What each source requires. A newsletter keeps the whole mail identity it always had. An
   article carries its bookmark id and none of the mail identity; its publication_id is left
   free, so a later story can link it to a roster row without a migration of these rows. A
   research post carries none of the mail identity and no publication; its bookmark id is the
   one its Send saved, as on a newsletter.';

comment on column reader_posts.html is
  'The email''s decoded text/html part, raw — no sanitising, no stripping of the mail''s chrome
   — or, for a research post, the report rendered from `text` at delivery (raw HTML in the
   markdown dropped). Sent to Instapaper as the bookmark''s content; the app never renders it and
   the list payload never carries it. Written only beside a non-empty `text`, which is what lets
   the retention sweep reach it. Null for every post ingested before this column existed; their
   sends fall back to the stored text.';

comment on column reader_posts.research_brief is
  'A research post''s question in the owner''s own words, as it was fired: the item''s title,
   then a blank line and its notes when it had any. What every fire and retry sends the Routine.
   Never swept — it can re-run the question after the report''s body is gone. Null off-source.';

comment on column reader_posts.research_state is
  'queued = the post exists but no fire has succeeded yet; researching = a fire succeeded and the
   session has not delivered; done = the report arrived (research_delivered_at); failed = the
   last fire was refused or never answered (research_error says why). A queued or researching
   post that has waited too long reads as stale in the app, which derives that at read time —
   nothing here marks it. Null for every non-research post. The summariser skips a research post
   until this is done, since it has no body before then.';

comment on column reader_posts.research_attempts is
  'How many times the app has fired the research Routine for this post, successful or not.';

comment on column reader_posts.research_fired_at is
  'The last fire the Routine accepted. A researching post whose last accepted fire is old enough
   reads as stale — the session never reported back.';

comment on column reader_posts.research_session_url is
  'The Claude Code session the last accepted fire started (the fire''s claude_code_session_url),
   which the row''s Session link opens. Null when the fire''s answer carried none.';

comment on column reader_posts.research_error is
  'Why the last fire failed, in the owner''s words — the row''s "No report — …" clause. Cleared
   by an accepted fire and by delivery.';

comment on column reader_posts.research_delivered_at is
  'When the report arrived. Delivery also moves received_at to the same instant, so a delivered
   report surfaces as new in the reading list.';

-- ── 3. Dispatch research rows to the Reader: stamp, insert, delete ───────────
-- The shape of send_items_to_wiki (0038), with one step between its two: the stamp logs any
-- classifier correction ("the classifier said task, the owner said research") through the 0029
-- trigger, the insert creates the post the report will fill, and only then are the items deleted.
-- One transaction, so the question is never in neither place — nor in both. The route fires the
-- Routine only after this commits, so a session always delivers to a post that exists.
--
-- All-or-nothing: every id must be a root, undispatched, childless research row, or nothing
-- changes. The route validates the same shape first and answers 409 with the offending id; this
-- guard is what holds at the instant of the write. `security invoker`: the route calls it as the
-- authenticated owner under RLS, exactly like the wiki send.
create or replace function send_items_to_research(p_ids uuid[]) returns setof reader_posts
language plpgsql security invoker as $$
declare
  v_bad uuid;
begin
  select id into v_bad from unnest(p_ids) as wanted(id)
   where not exists (
     select 1 from items i
      where i.id = wanted.id
        and i.item_type = 'research'
        and i.parent_id is null
        and i.dispatched_at is null
   )
   limit 1;
  if v_bad is not null then
    raise exception 'send_items_to_research: % is not an undispatched root research item', v_bad
      using errcode = 'check_violation';
  end if;

  select parent_id into v_bad from items where parent_id = any(p_ids) limit 1;
  if v_bad is not null then
    raise exception 'send_items_to_research: % has subtasks', v_bad
      using errcode = 'check_violation';
  end if;

  update items set dispatched_at = now() where id = any(p_ids);

  return query
    with inserted as (
      insert into reader_posts (source, title, research_brief, research_state, received_at)
      select 'research',
             i.title,
             i.title || case when coalesce(btrim(i.notes), '') = '' then ''
                             else E'\n\n' || btrim(i.notes) end,
             'queued',
             now()
        from items i
       where i.id = any(p_ids)
      returning *
    )
    select * from inserted;

  delete from items where id = any(p_ids);
end; $$;

comment on function send_items_to_research(uuid[]) is
  'Consume research items into queued Reader posts, all or nothing: stamp dispatched_at (which
   logs any classifier correction), insert one research post per item with its brief (title,
   then notes), delete the items, and return the new posts. Refuses — changing nothing — a batch
   holding any id that is not an undispatched, childless root research item.';

grant execute on function send_items_to_research(uuid[]) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
