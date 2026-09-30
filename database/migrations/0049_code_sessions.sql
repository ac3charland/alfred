-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — The coding-session ledger (ALF-309).
--
-- One row per Claude Code session that worked on an alfred repo: what ran it (model, effort), what
-- it cost, which PR it produced and how that PR ended, and — rebuilt from git history — the
-- launch prompt, the spec it read and the skills that prompt named. Seeded by the session-ledger
-- backfill (tools/session-ledger); a later recording hook upserts into the same table.
--
--   1. code_sessions — keyed by the session id. `ref` carries no FK: a story or epic ref that
--      outlives a deleted ticket is still history. `session_record` keeps the raw get_session
--      JSON so a later column can be backfilled in SQL without another sweep over every session.
--   2. upsert_code_sessions — the only write path the backfill uses. Every column is refreshed on
--      each run, EXCEPT that a stored `recorded` prompt (the exact text a recording hook saw)
--      keeps its prompt, provenance, builder and base when a `reconstructed` row arrives for the
--      same session. The rule lives here rather than in a route so no client can bypass it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The ledger ────────────────────────────────────────────────────────────
create table code_sessions (
  session_id               text primary key,
  repo                     text not null,
  title                    text,
  session_created_at       timestamptz,
  status                   text,
  configured_model         text,
  model                    text,
  served_model             text,
  effort_level             text,
  cost_usd                 numeric(12,6),
  input_tokens             bigint,
  output_tokens            bigint,
  cache_read_tokens        bigint,
  cache_write_tokens       bigint,
  ref                      text,          -- story OR epic ref; no FK, survives deletes
  launch_lane              text check (launch_lane in ('refinement','spike','bug','implementation',
                             'bypass','epic-refinement','epic-implementation')),
  pr_number                int,
  pr_state                 text check (pr_state in ('merged','closed','open')),
  pr_opened_at             timestamptz,
  pr_merged_at             timestamptz,
  pr_closed_at             timestamptz,
  human_commits_after_open int,
  base_sha                 text,
  builder_sha              text,
  prompt                   text,
  prompt_source            text check (prompt_source in ('reconstructed','recorded')),
  spec_path                text,
  spec_blob_sha            text,
  skills                   jsonb not null default '[]',   -- [{path, blob_sha|null}]
  warnings                 text[] not null default '{}',
  session_record           jsonb,
  refreshed_at             timestamptz not null default now()
);

create index code_sessions_ref_idx on code_sessions (ref);

comment on column code_sessions.launch_lane is
  'Which alfred launch prompt started the session, inferred from its PR''s alfred block. Not '
  '`lane`: code_items.lane already means something else.';
comment on column code_sessions.base_sha is
  'The last first-parent commit on main at or before session_created_at — the commit the prompt, '
  'spec and skills are all resolved at.';
comment on column code_sessions.builder_sha is
  'The last commit that changed frontend/lib/code/links.ts as of base_sha; groups rows by prompt '
  'version.';
comment on column code_sessions.prompt_source is
  '`reconstructed` when rebuilt from history; `recorded` when a session wrote its own prompt. A '
  'recorded prompt is never overwritten by a reconstructed one (upsert_code_sessions).';
comment on column code_sessions.warnings is
  'Why each missing value is missing (no_pr, builder_missing, not_from_main, …), sorted and '
  'deduplicated. There are no silent nulls.';
comment on column code_sessions.session_record is
  'The whole get_session JSON, verbatim, so a later column can be derived in SQL without '
  'refetching every session.';

-- RLS + GRANTs, the 0035 template: the authenticated owner has full access, anon is denied (no
-- policy), and the service role bypasses RLS by design — that is the keyed route's admin client.
-- Raw `psql -f` gets none of Supabase's auto-grants, so DML is granted explicitly. No realtime:
-- nothing in the app reads the ledger yet.
alter table code_sessions enable row level security;

create policy "authenticated full access" on code_sessions
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on code_sessions to anon, authenticated, service_role;

-- ── 2. The upsert ────────────────────────────────────────────────────────────
-- One statement: the `prior` CTE reads the table as it stood before the insert (every CTE in a
-- statement shares one snapshot), so it counts exactly the rows whose recorded prompt the
-- conflict branch is about to keep.
--
-- `refreshed_at` is always now(): a caller's value would claim a refresh that didn't happen.
-- `skills` / `warnings` coalesce to their defaults, because jsonb_populate_recordset yields null
-- for an absent key and both columns are not null.
--
-- A batch naming one session twice fails the whole statement ("cannot affect row a second
-- time"), so the route rejects that before it gets here.
--
-- `security invoker`, like every alfred RPC: RLS keeps applying to whoever calls it.
create function upsert_code_sessions(p_rows jsonb)
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
      session_created_at       = excluded.session_created_at,
      status                   = excluded.status,
      configured_model         = excluded.configured_model,
      model                    = excluded.model,
      served_model             = excluded.served_model,
      effort_level             = excluded.effort_level,
      cost_usd                 = excluded.cost_usd,
      input_tokens             = excluded.input_tokens,
      output_tokens            = excluded.output_tokens,
      cache_read_tokens        = excluded.cache_read_tokens,
      cache_write_tokens       = excluded.cache_write_tokens,
      ref                      = excluded.ref,
      launch_lane              = excluded.launch_lane,
      pr_number                = excluded.pr_number,
      pr_state                 = excluded.pr_state,
      pr_opened_at             = excluded.pr_opened_at,
      pr_merged_at             = excluded.pr_merged_at,
      pr_closed_at             = excluded.pr_closed_at,
      human_commits_after_open = excluded.human_commits_after_open,
      spec_path                = excluded.spec_path,
      spec_blob_sha            = excluded.spec_blob_sha,
      skills                   = excluded.skills,
      warnings                 = excluded.warnings,
      session_record           = excluded.session_record,
      refreshed_at             = now(),
      -- Recorded wins: a reconstructed row never replaces the prompt a session recorded itself,
      -- nor the builder and base that prompt came with.
      prompt = case when code_sessions.prompt_source = 'recorded'
                     and excluded.prompt_source is distinct from 'recorded'
                    then code_sessions.prompt else excluded.prompt end,
      prompt_source = case when code_sessions.prompt_source = 'recorded'
                            and excluded.prompt_source is distinct from 'recorded'
                           then code_sessions.prompt_source else excluded.prompt_source end,
      builder_sha = case when code_sessions.prompt_source = 'recorded'
                          and excluded.prompt_source is distinct from 'recorded'
                         then code_sessions.builder_sha else excluded.builder_sha end,
      base_sha = case when code_sessions.prompt_source = 'recorded'
                       and excluded.prompt_source is distinct from 'recorded'
                      then code_sessions.base_sha else excluded.base_sha end
    returning session_id
  )
  select (select count(*) from written)::int, (select count(*) from prior)::int;
$$;

grant execute on function upsert_code_sessions(jsonb) to anon, authenticated, service_role;
