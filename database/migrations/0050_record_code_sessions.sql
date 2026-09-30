-- ═══════════════════════════════════════════════════════════════════════════
-- 0050 — Sessions record themselves into the ledger (ALF-310).
--
-- Every alfred cloud session now writes its own `code_sessions` row as it runs, from a Claude Code
-- hook (tools/session-ledger/src/hook): the prompt exactly as sent, the commit it started on, and
-- its token usage per model, main thread and subagents apart. The transcript carries no cost, so
-- alfred prices the recorded tokens itself from a dated history of Anthropic's published rates,
-- which the Worker refreshes on its daily tick.
--
--   1. code_sessions — three columns only the hook writes: `subagent_count`, `usage_by_model`
--      (`{main: {<model>: U}, subagents: {<model>: U}}`, U = {requests, input, output, cache_read,
--      cache_write_5m, cache_write_1h, web_search}) and `recorded_at` (the last hook write).
--   2. model_price_history — one row per distinct rate table, each the WHOLE table as of its
--      `effective_from`; `model_rates` / `code_session_cost` price usage at the rates in effect
--      when it happened; `append_model_prices` is the Worker's one write.
--   3. record_code_session — the hook's one write path.
--   4. upsert_code_sessions, amended so a backfill re-run leaves recorded data alone.
--
-- Who owns each column, enforced by the two RPCs so no client can bypass it:
--
--   hook-owned       tokens, cost_usd (priced here, never sent), served_model, subagent_count,
--                    usage_by_model, recorded_at — the hook writes them on every stop; the backfill
--                    keeps them once the row is recorded.
--   recorded-wins    prompt, prompt_source, skills, base_sha, builder_sha — the hook's first write
--                    of each freezes it; the backfill fills them only where the hook couldn't.
--   platform-owned   session_created_at, model, effort_level, ref — the hook fills them while null,
--                    and on a recorded row the backfill overwrites them only with a value.
--   backfill-only    everything else — the hook never writes it.
--
-- The rule for the last two classes is what makes the final row the same whichever order the
-- hook and a backfill run in.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The recorded columns ──────────────────────────────────────────────────
alter table code_sessions
  add column subagent_count int,
  add column usage_by_model jsonb,
  add column recorded_at    timestamptz;

comment on column code_sessions.usage_by_model is
  'Token usage per model, `{main: {<model>: U}, subagents: {<model>: U}}` with U = {requests, '
  'input, output, cache_read, cache_write_5m, cache_write_1h, web_search}. Written only by the '
  'recording hook; the token columns hold the whole-session totals, subagents included.';
comment on column code_sessions.recorded_at is
  'The last write by the session''s own recording hook; null for a row only the backfill wrote.';

-- The warning codes the recording path owns. Each RPC replaces only its own codes, so neither drops
-- the other's: record_code_session rewrites these, upsert_code_sessions rewrites everything else.
create function code_session_hook_warnings() returns text[]
language sql immutable as $$
  select array['price_unknown', 'start_unrecorded', 'subagents_unreadable', 'transcript_regressed']
$$;

-- `p_warnings` without `price_unknown`, plus it when `p_unknown`, sorted and deduplicated.
create function code_session_priced_warnings(p_warnings text[], p_unknown boolean) returns text[]
language sql immutable as $$
  select array(
    select distinct w
      from unnest(array_remove(coalesce(p_warnings, '{}'), 'price_unknown')
                  || case when p_unknown then array['price_unknown'] else '{}'::text[] end) w
     order by w
  )
$$;

-- ── 2. Prices ────────────────────────────────────────────────────────────────
-- No sequence (the key is the fetch time), so no sequence grant.
create table model_price_history (
  effective_from timestamptz primary key,
  fetched_at     timestamptz not null,
  source         text not null,
  rates          jsonb not null          -- {<model id>: {name, in, cw5m, cw1h, read, out}}, USD/MTok
);

comment on table model_price_history is
  'Anthropic''s published per-model rates, one row per distinct table. Each row is the whole table '
  'as of effective_from: a fetch is merged over the latest row, so a model a fetch omits keeps its '
  'last rates. Written only by append_model_prices.';

-- RLS + GRANTs, the 0049 pattern: the authenticated owner has full access, anon is denied (no
-- policy), and the Worker writes as the service role, which bypasses RLS.
alter table model_price_history enable row level security;

create policy "authenticated full access" on model_price_history
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on model_price_history to anon, authenticated, service_role;

-- The rates for `p_model` at `p_at`. A trailing -YYYYMMDD snapshot suffix is stripped; nothing else
-- is normalised, so `claude-opus-5-9` never falls back to `claude-opus-5` and a `/fast` variant
-- (billed differently) stays unpriced. Reads the row in effect at `p_at`; a model that row lacks
-- takes the earliest later row that has it, so a model's launch price applies back to its first
-- use. Null when no row prices the model — never a guess.
create function model_rates(p_model text, p_at timestamptz) returns jsonb
language sql stable security invoker as $$
  with m as (select regexp_replace(p_model, '-[0-9]{8}$', '') as id)
  select coalesce(
    (select h.rates -> m.id
       from model_price_history h
      where h.effective_from <= p_at
      order by h.effective_from desc
      limit 1),
    (select h.rates -> m.id
       from model_price_history h
      where h.effective_from > p_at and h.rates ? m.id
      order by h.effective_from
      limit 1)
  )
  from m
$$;

-- What `p_usage` (a `usage_by_model` value) cost at `p_at`, in USD to 6 places: each model's five
-- token classes at its rates, main thread and subagents alike. Null when the usage is null or any
-- model in it is unpriced. Web searches are counted in the usage but the rate table has no price
-- for them.
create function code_session_cost(p_usage jsonb, p_at timestamptz) returns numeric
language sql stable security invoker as $$
  with entries as (
    select e.value as u, model_rates(e.key, p_at) as r
      from jsonb_each(coalesce(p_usage -> 'main', '{}')) e
    union all
    select e.value, model_rates(e.key, p_at)
      from jsonb_each(coalesce(p_usage -> 'subagents', '{}')) e
  )
  select case
    when p_usage is null or bool_or(r is null) then null
    else round(coalesce(sum(
        (r ->> 'in')::numeric   * coalesce((u ->> 'input')::numeric, 0)
      + (r ->> 'cw5m')::numeric * coalesce((u ->> 'cache_write_5m')::numeric, 0)
      + (r ->> 'cw1h')::numeric * coalesce((u ->> 'cache_write_1h')::numeric, 0)
      + (r ->> 'read')::numeric * coalesce((u ->> 'cache_read')::numeric, 0)
      + (r ->> 'out')::numeric  * coalesce((u ->> 'output')::numeric, 0)
    ), 0) / 1000000, 6)
  end
  from entries
$$;

-- The Worker's daily write: merge `p_rates` over the latest table, append a row only when some
-- model's rates changed, then re-price every recorded session (the cost is a pure function of its
-- stored usage and this history, so re-pricing is idempotent). `changed` names the models whose
-- rates differ from the latest row; `repriced` counts sessions whose cost or `price_unknown` moved.
-- Rows only the backfill wrote (recorded_at null) keep the cost their session record carried.
create function append_model_prices(p_rates jsonb, p_source text)
returns table (appended boolean, changed text[], repriced int)
language plpgsql security invoker as $$
declare
  v_latest   jsonb;
  v_changed  text[];
  v_repriced int;
begin
  if jsonb_typeof(p_rates) is distinct from 'object' or exists (
    select 1
      from jsonb_each(p_rates) e,
           unnest(array['in', 'cw5m', 'cw1h', 'read', 'out']) f
     where jsonb_typeof(e.value -> f) is distinct from 'number'
  ) then
    raise exception 'p_rates must map each model id to numeric in, cw5m, cw1h, read and out'
      using errcode = '22023';
  end if;

  -- One append at a time, so two concurrent fetches can't both merge over the same latest row.
  lock table model_price_history in share row exclusive mode;

  select h.rates into v_latest from model_price_history h order by h.effective_from desc limit 1;
  v_latest := coalesce(v_latest, '{}');

  v_changed := array(
    select e.key
      from jsonb_each(p_rates) e
     where (v_latest -> e.key) - 'name' is distinct from e.value - 'name'
     order by e.key
  );
  if cardinality(v_changed) = 0 then
    return query select false, '{}'::text[], 0;
    return;
  end if;

  insert into model_price_history (effective_from, fetched_at, source, rates)
  values (clock_timestamp(), clock_timestamp(), p_source, v_latest || p_rates);

  with priced as (
    select s.session_id, code_session_cost(s.usage_by_model, s.session_created_at) as cost
      from code_sessions s
     where s.recorded_at is not null
  )
  update code_sessions s
     set cost_usd = p.cost,
         warnings = code_session_priced_warnings(
           s.warnings, s.usage_by_model is not null and p.cost is null)
    from priced p
   where s.session_id = p.session_id
     and (s.cost_usd is distinct from p.cost
          or s.warnings is distinct from code_session_priced_warnings(
               s.warnings, s.usage_by_model is not null and p.cost is null));
  get diagnostics v_repriced = row_count;

  return query select true, v_changed, v_repriced;
end;
$$;

-- ── 3. The hook's write ──────────────────────────────────────────────────────
-- `p_row` is one hook write: `event` ('session-start' | 'stop') plus a subset of code_sessions'
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
-- - The platform-owned columns are filled only while null.
-- - cost_usd is re-priced from whatever usage is stored, with `price_unknown` when it can't be.
-- - Warnings: the stored codes minus the hook's, plus the ones this write sent or set.
create function record_code_session(p_row jsonb)
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
  v_warnings  text[];
begin
  if v_event is null or v_event not in ('session-start', 'stop') then
    raise exception 'event must be session-start or stop' using errcode = '22023';
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
    recorded_at        = now(),
    refreshed_at       = now()
  where s.session_id = v_in.session_id
  returning code_session_cost(s.usage_by_model, s.session_created_at),
            s.usage_by_model is not null
       into v_cost, v_take_usage;   -- reused: whether the stored row now has usage to price

  v_warnings := array(
    select w from unnest(coalesce(v_old.warnings, '{}')) w
     where w <> all (code_session_hook_warnings())
    union
    select w from unnest(coalesce(v_in.warnings, '{}')) w
     where w in ('start_unrecorded', 'subagents_unreadable')
    union
    select 'transcript_regressed'
     where v_regressed or 'transcript_regressed' = any (v_old.warnings)
  );

  update code_sessions s set
    cost_usd = v_cost,
    warnings = code_session_priced_warnings(v_warnings, v_take_usage and v_cost is null)
  where s.session_id = v_in.session_id;

  return query select v_inserted;
end;
$$;

-- ── 4. The backfill's write, amended ─────────────────────────────────────────
-- 0049's upsert, with the recorded path's columns left alone:
--
-- - On a recorded row (recorded_at not null) the hook-owned columns keep their stored values, and
--   the platform-owned ones take the backfill's value only when it has one.
-- - A recorded prompt keeps its skills as well as its builder and base (0049's rule). The start
--   commit the hook captured is kept even before a prompt is recorded. When the hook's session
--   start went unrecorded (`start_unrecorded`), the backfill still fills base, builder and skills.
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
      launch_lane              = excluded.launch_lane,
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
      -- Hook-owned: a recorded row's usage and cost are the session's own.
      served_model = case when code_sessions.recorded_at is null then excluded.served_model
                          else code_sessions.served_model end,
      cost_usd = case when code_sessions.recorded_at is null then excluded.cost_usd
                      else code_sessions.cost_usd end,
      input_tokens = case when code_sessions.recorded_at is null then excluded.input_tokens
                          else code_sessions.input_tokens end,
      output_tokens = case when code_sessions.recorded_at is null then excluded.output_tokens
                           else code_sessions.output_tokens end,
      cache_read_tokens = case when code_sessions.recorded_at is null
                               then excluded.cache_read_tokens
                               else code_sessions.cache_read_tokens end,
      cache_write_tokens = case when code_sessions.recorded_at is null
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
                     and not ('start_unrecorded' = any (code_sessions.warnings))
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

grant execute on function
  code_session_hook_warnings(),
  code_session_priced_warnings(text[], boolean),
  model_rates(text, timestamptz),
  code_session_cost(jsonb, timestamptz),
  append_model_prices(jsonb, text),
  record_code_session(jsonb)
  to anon, authenticated, service_role;
