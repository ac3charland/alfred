-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 — A session's link reaches its ticket on the first prompt (ALF-359).
--
-- The story detail lists every Claude Code session recorded against the story, each opening
-- claude.ai/code/<session_id>. For the link to appear while the session is still on its first
-- turn, the recording hook now also writes on the session's first prompt (`event: 'prompt'`),
-- carrying the prompt, its skills and its ref. The record route classifies that prompt into the
-- launch lane that labels the link.
--
--   1. record_code_session — accepts the `prompt` event; fills launch_lane while null; keeps the
--      stop codes on every event but a stop (a prompt write reads no transcript).
--   2. upsert_code_sessions — launch_lane moves to the platform-owned rule, so a backfill keeps a
--      recorded lane where it has none, and replaces it where it has one (the PR's block is the
--      more authoritative source).
--   3. code_sessions joins the supabase_realtime publication, so an open board shows a session
--      recorded while it sits open.
--
-- Column ownership, superseding 0050's table:
--
--   hook-owned       tokens, cost_usd (priced here, never sent), served_model, subagent_count,
--                    usage_by_model, recorded_at — the hook writes them on every stop; the backfill
--                    keeps them once the hook has recorded usage.
--   recorded-wins    prompt, prompt_source, skills, base_sha, builder_sha — the hook's first write
--                    of each freezes it (a prompt write or a stop, whichever lands first); the
--                    backfill fills them only where the hook couldn't.
--   platform-owned   session_created_at, model, effort_level, ref, launch_lane — the hook fills
--                    them while null, and on a recorded row the backfill overwrites them only with
--                    a value.
--   backfill-only    everything else — the hook never writes it.
--
-- Same signatures, so `create or replace` keeps 0049/0050's grants and adds no overload.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The hook's write ──────────────────────────────────────────────────────
-- `p_row` is one hook write: `event` ('session-start' | 'prompt' | 'stop') plus a subset of code_sessions'
-- columns. Only the hook-owned, recorded-wins and platform-owned columns are read from it; a
-- backfill-only column or a cost in `p_row` is ignored. Every write is the whole picture so far,
-- so a missed one is healed by the next.
--
-- - Usage (tokens, served_model, subagent_count, usage_by_model) is replaced on every stop, except
--   that recorded usage never goes backwards: a stop reporting fewer output tokens than the hook
--   stored before (a re-provisioned container restoring a shorter transcript) keeps the stored
--   usage and sets `transcript_regressed`, which then sticks.
-- - The first recorded prompt freezes prompt, prompt_source and the skills sent with it.
-- - base_sha and builder_sha come from a session-start write, until the hook has recorded them.
-- - The platform-owned columns (launch_lane among them) are filled only while null.
-- - cost_usd is re-priced from the usage the hook stored, with `price_unknown` when a model has no
--   rate and no cost when a subagent's usage was only partly recorded; a row the hook has stored no
--   usage for keeps the cost it has.
-- - Warnings: the backfill's codes are kept; only a stop replaces the stop codes, and the RPC sets
--   `transcript_regressed` (which sticks) and `price_unknown`.
create or replace function record_code_session(p_row jsonb)
returns table (inserted boolean)
language plpgsql security invoker as $$
declare
  v_in          code_sessions;
  v_old         code_sessions;
  v_event       text := p_row ->> 'event';
  v_inserted    boolean;
  v_take_usage  boolean;
  v_regressed   boolean;
  v_take_prompt boolean;
  v_take_start  boolean;
  v_cost        numeric;
  v_unknown     boolean;
  v_usage       jsonb;
  v_created     timestamptz;
  v_warnings    text[];
begin
  if v_event is null or v_event not in ('session-start', 'prompt', 'stop') then
    raise exception 'event must be session-start, prompt or stop' using errcode = '22023';
  end if;
  v_in := jsonb_populate_record(null::code_sessions, p_row);

  -- A skeleton for a new session; every column below is then decided by the same rules, whether
  -- the row is new, backfilled, or recorded before.
  insert into code_sessions (session_id, repo) values (v_in.session_id, v_in.repo)
  on conflict (session_id) do nothing;
  v_inserted := found;

  select * into v_old from code_sessions where session_id = v_in.session_id for update;

  -- Only usage the hook itself stored (usage_by_model is its alone) can regress; a backfill's
  -- session-record totals are simply replaced.
  v_take_usage := v_in.output_tokens is not null
    and (v_old.usage_by_model is null or v_old.output_tokens is null
         or v_in.output_tokens >= v_old.output_tokens);
  v_regressed := v_in.output_tokens is not null and not v_take_usage;
  v_take_prompt := v_in.prompt is not null and v_old.prompt_source is distinct from 'recorded';
  v_take_start := v_event = 'session-start'
    and (v_old.recorded_at is null or v_old.base_sha is null);

  update code_sessions s set
    input_tokens       = case when v_take_usage then v_in.input_tokens else s.input_tokens end,
    output_tokens      = case when v_take_usage then v_in.output_tokens else s.output_tokens end,
    cache_read_tokens  = case when v_take_usage then v_in.cache_read_tokens
                              else s.cache_read_tokens end,
    cache_write_tokens = case when v_take_usage then v_in.cache_write_tokens
                              else s.cache_write_tokens end,
    served_model       = case when v_take_usage then v_in.served_model else s.served_model end,
    subagent_count     = case when v_take_usage then v_in.subagent_count else s.subagent_count end,
    usage_by_model     = case when v_take_usage then v_in.usage_by_model else s.usage_by_model end,
    prompt             = case when v_take_prompt then v_in.prompt else s.prompt end,
    prompt_source      = case when v_take_prompt then 'recorded' else s.prompt_source end,
    skills             = case when v_take_prompt and jsonb_typeof(p_row -> 'skills') = 'array'
                              then v_in.skills else s.skills end,
    base_sha           = case when v_take_start then v_in.base_sha else s.base_sha end,
    builder_sha        = case when v_take_start then v_in.builder_sha else s.builder_sha end,
    session_created_at = coalesce(s.session_created_at, v_in.session_created_at),
    model              = coalesce(s.model, v_in.model),
    effort_level       = coalesce(s.effort_level, v_in.effort_level),
    ref                = coalesce(s.ref, v_in.ref),
    launch_lane        = coalesce(s.launch_lane, v_in.launch_lane),
    recorded_at        = now(),
    refreshed_at       = now()
  where s.session_id = v_in.session_id
  returning s.usage_by_model, s.session_created_at into v_usage, v_created;

  v_warnings := array(
    select w from unnest(coalesce(v_old.warnings, '{}')) w
     where w <> all (code_session_hook_warnings())
    union
    -- The stop codes describe the transcripts a stop read: only a stop replaces them.
    select w from unnest(coalesce(v_old.warnings, '{}')) w
     where v_event <> 'stop' and w = any (code_session_stop_warnings())
    union
    select w from unnest(coalesce(v_in.warnings, '{}')) w
     where v_event = 'stop' and w = any (code_session_stop_warnings())
    union
    select 'transcript_regressed'
     where v_regressed or 'transcript_regressed' = any (v_old.warnings)
  );

  if v_usage is not null then
    v_cost := code_session_recorded_cost(v_usage, v_created, v_warnings);
    v_unknown := code_session_cost(v_usage, v_created) is null;
    update code_sessions s set
      cost_usd = v_cost,
      warnings = code_session_priced_warnings(v_warnings, v_unknown)
    where s.session_id = v_in.session_id;
  else
    update code_sessions s set
      warnings = code_session_priced_warnings(v_warnings, false)
    where s.session_id = v_in.session_id;
  end if;

  return query select v_inserted;
end;
$$;

-- ── 2. The backfill's write ──────────────────────────────────────────────────
-- 0049's upsert, with the recorded path's columns left alone:
--
-- - Once the hook has recorded usage (usage_by_model not null) the hook-owned columns keep their
--   stored values; on any recorded row (recorded_at not null) the platform-owned ones take the
--   backfill's value only when it has one.
-- - A recorded prompt keeps its skills as well as its builder and base (0049's rule). The start
--   commit the hook captured is kept even before a prompt is recorded. When the hook's session
--   start went unrecorded (`start_unrecorded`), the backfill still fills base and builder, and the
--   skills while none are stored.
-- - subagent_count, usage_by_model and recorded_at are never written here.
-- - Warnings: the incoming codes plus the stored recording codes, so neither path drops the other's.
--
-- Same signature, so `create or replace` keeps 0049's grants and no second overload appears.
create or replace function upsert_code_sessions(p_rows jsonb)
returns table (upserted int, kept_recorded int)
language sql security invoker as $$
  with incoming as (
    select * from jsonb_populate_recordset(null::code_sessions, p_rows)
  ),
  prior as (
    select s.session_id
      from code_sessions s
      join incoming i using (session_id)
     where s.prompt_source = 'recorded'
       and i.prompt_source is distinct from 'recorded'
  ),
  written as (
    insert into code_sessions (
      session_id, repo, title, session_created_at, status,
      configured_model, model, served_model, effort_level,
      cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      ref, launch_lane,
      pr_number, pr_state, pr_opened_at, pr_merged_at, pr_closed_at, human_commits_after_open,
      base_sha, builder_sha, prompt, prompt_source,
      spec_path, spec_blob_sha, skills, warnings, session_record, refreshed_at
    )
    select
      session_id, repo, title, session_created_at, status,
      configured_model, model, served_model, effort_level,
      cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      ref, launch_lane,
      pr_number, pr_state, pr_opened_at, pr_merged_at, pr_closed_at, human_commits_after_open,
      base_sha, builder_sha, prompt, prompt_source,
      spec_path, spec_blob_sha, coalesce(skills, '[]'::jsonb), coalesce(warnings, '{}'::text[]),
      session_record, now()
    from incoming
    on conflict (session_id) do update set
      repo                     = excluded.repo,
      title                    = excluded.title,
      status                   = excluded.status,
      configured_model         = excluded.configured_model,
      pr_number                = excluded.pr_number,
      pr_state                 = excluded.pr_state,
      pr_opened_at             = excluded.pr_opened_at,
      pr_merged_at             = excluded.pr_merged_at,
      pr_closed_at             = excluded.pr_closed_at,
      human_commits_after_open = excluded.human_commits_after_open,
      spec_path                = excluded.spec_path,
      spec_blob_sha            = excluded.spec_blob_sha,
      session_record           = excluded.session_record,
      refreshed_at             = now(),
      -- Platform-owned: the platform's value wins, but a recorded row keeps the hook's where the
      -- backfill has none.
      session_created_at = case when code_sessions.recorded_at is null
                                then excluded.session_created_at
                                else coalesce(excluded.session_created_at,
                                              code_sessions.session_created_at) end,
      model = case when code_sessions.recorded_at is null then excluded.model
                   else coalesce(excluded.model, code_sessions.model) end,
      effort_level = case when code_sessions.recorded_at is null then excluded.effort_level
                          else coalesce(excluded.effort_level, code_sessions.effort_level) end,
      ref = case when code_sessions.recorded_at is null then excluded.ref
                 else coalesce(excluded.ref, code_sessions.ref) end,
      launch_lane = case when code_sessions.recorded_at is null then excluded.launch_lane
                         else coalesce(excluded.launch_lane, code_sessions.launch_lane) end,
      -- Hook-owned: once the hook has recorded usage, the usage and its cost are the session's own.
      served_model = case when code_sessions.usage_by_model is null then excluded.served_model
                          else code_sessions.served_model end,
      cost_usd = case when code_sessions.usage_by_model is null then excluded.cost_usd
                      else code_sessions.cost_usd end,
      input_tokens = case when code_sessions.usage_by_model is null then excluded.input_tokens
                          else code_sessions.input_tokens end,
      output_tokens = case when code_sessions.usage_by_model is null then excluded.output_tokens
                           else code_sessions.output_tokens end,
      cache_read_tokens = case when code_sessions.usage_by_model is null
                               then excluded.cache_read_tokens
                               else code_sessions.cache_read_tokens end,
      cache_write_tokens = case when code_sessions.usage_by_model is null
                                then excluded.cache_write_tokens
                                else code_sessions.cache_write_tokens end,
      -- Recorded wins: a reconstructed row never replaces the prompt a session recorded itself.
      prompt = case when code_sessions.prompt_source = 'recorded'
                     and excluded.prompt_source is distinct from 'recorded'
                    then code_sessions.prompt else excluded.prompt end,
      prompt_source = case when code_sessions.prompt_source = 'recorded'
                            and excluded.prompt_source is distinct from 'recorded'
                           then code_sessions.prompt_source else excluded.prompt_source end,
      skills = case when code_sessions.prompt_source = 'recorded'
                     and excluded.prompt_source is distinct from 'recorded'
                     and (not ('start_unrecorded' = any (code_sessions.warnings))
                          or jsonb_array_length(code_sessions.skills) > 0)
                    then code_sessions.skills else excluded.skills end,
      builder_sha = case when (code_sessions.prompt_source = 'recorded'
                               and excluded.prompt_source is distinct from 'recorded'
                               and not ('start_unrecorded' = any (code_sessions.warnings)))
                           or (code_sessions.recorded_at is not null
                               and code_sessions.base_sha is not null)
                         then code_sessions.builder_sha else excluded.builder_sha end,
      base_sha = case when (code_sessions.prompt_source = 'recorded'
                            and excluded.prompt_source is distinct from 'recorded'
                            and not ('start_unrecorded' = any (code_sessions.warnings)))
                        or (code_sessions.recorded_at is not null
                            and code_sessions.base_sha is not null)
                      then code_sessions.base_sha else excluded.base_sha end,
      warnings = array(
        select distinct w
          from unnest(excluded.warnings
                      || array(select unnest(code_sessions.warnings)
                               intersect
                               select unnest(code_session_hook_warnings()))) w
         order by w
      )
    returning session_id
  )
  select (select count(*) from written)::int, (select count(*) from prior)::int;
$$;

comment on column code_sessions.launch_lane is
  'Which alfred launch prompt started the session: read from the recorded prompt''s opening '
  'lines by the record route, or inferred from its PR''s alfred block by the backfill, which wins '
  'when it has a value. Not `lane`: code_items.lane already means something else.';

-- ── 3. Realtime ──────────────────────────────────────────────────────────────
-- RLS still governs the stream: code_sessions has 0049's `authenticated full access` policy, so
-- only the signed-in owner receives its changes.
alter publication supabase_realtime add table code_sessions;

notify pgrst, 'reload schema';
