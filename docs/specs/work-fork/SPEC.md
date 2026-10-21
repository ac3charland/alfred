# Work fork of alfred — spec and chunked build plan

> **Status:** Planning spec, ready to drive implementation sessions.
> **Audience:** The owner, and the Claude Code sessions (Opus 5.5, medium effort) that build the fork
> one chunk at a time.
> **Scope:** What the fork is, the decisions that shape it (with the recommended answer to each open
> question), the target architecture, and an ordered list of chunks each sized for one session.
> **Not in scope:** Per-chunk specs. Each chunk is refined in its own session from the brief in §7.

---

## 0. Summary

A private fork of alfred that runs **entirely on one work machine** from a dev server: Next.js
talking to a **local Postgres through PostgREST**, with a small long-running **runner** process that
replaces the Cloudflare Worker. The **tasks** module stays as it is. The **reader, comms, wiki and
research** modules, the Mac daemon, the Cloudflare Worker and every Anthropic call are removed. The
**code** module keeps its refine → implement lifecycle and board but is re-pointed at **Jira** (tickets),
**GitLab** (merge requests) and the **GitHub Copilot CLI** (sessions that run locally in git
worktrees, launched from the board). Backups are automatic `pg_dump` snapshots to a folder you choose.

The plan is 22 chunks in five phases. Phase 1 gets the current app running offline first, so every
later chunk has a live app to demo against.

---

## 1. Requirements, restated with the interpretation this plan builds

| # | You said | This plan reads it as |
|---|---|---|
| R1 | Completely offline, run from a dev server, data on the machine, framework-agnostic, keep end-to-end type safety, automatic backups | No cloud service in the runtime path. "Offline" means the **app** never needs the internet; the code module still calls your company's Jira and GitLab, which are on the corporate network. Type safety stays the generated-types → typed client → Zod → typed store chain. Backups are scheduled, local, restorable, and verified by a check. |
| R2 | Tasks as-is; code overhauled; reader, wiki, comms removed; wiki undecided | Tasks is untouched in behaviour, though its data plumbing is swapped under it (§3 D1) and its dispatch hooks into wiki and research are removed. Wiki is **cut** in this plan, with the reasoning in D4 and a cheap way back. |
| R3.1–3.2 | Copilot, not Claude Code; no cloud sessions; Copilot CLI may be triggered programmatically | Sessions run **on the machine** as Copilot CLI processes in git worktrees, started and tracked by the runner. The "human reviews the prompt before anything runs" affordance is kept. |
| R3.3 | GitLab, not GitHub | Merge requests are the completion signal. No inbound webhook is possible on a laptop, so the runner **polls** GitLab. |
| R3.4 | Jira tracks tickets | Jira is the **system of record** for a ticket's existence, key, title, description and status. The fork mirrors a JQL-selected set and layers its own factory state, ordering, notes, MR links and sessions on top. |
| R3.5 | You can mint Jira and GitLab tokens | Tokens live in `.env.local` only, like every secret in alfred today. |

**A constraint you did not state but the plan depends on:** the fork is developed on your personal
account (Claude Code needs GitHub) and then cloned at work. So the repo must be **work-shaped but
never work-specific**: no Jira host, project keys, repo paths, names or ticket text in any committed
file. Everything like that lives in `.env.local` or in the local database.

---

## 2. What the codebase actually looks like (the facts the decisions rest on)

Verified against the repo in this session:

- **Every data access speaks the PostgREST wire protocol.** The frontend uses supabase-js (postgrest-js)
  through `frontend/lib/supabase/server.ts`; the Worker uses raw `fetch` against `/rest/v1`
  (`workers/src/supabase.ts`); the Playwright suite runs the real Next server against an in-memory
  PostgREST emulation (`frontend/scripts/mock-supabase.mjs`, 2,856 lines).
- **Business invariants live in SQL, not app code.** 56 migrations, about 76 plpgsql functions,
  10 triggers, 9 views, 8 enums, recursive CTEs for subtrees and recurrence, advisory locks for
  priority swaps. The frontend calls 19 RPCs; the Worker 6.
- **The database package already runs a local Postgres.** `database/src/cluster.ts` does `initdb` and
  `pg_ctl` on a throwaway data dir; `migrate.ts` bootstraps the `anon`/`authenticated`/`service_role`
  roles and applies every migration. `gen-types` and `test:integration` use it, so the generated
  types never needed Supabase.
- **Auth is a login page plus role-based RLS with no per-user scoping.** Every policy is
  `to authenticated`; there is no `auth.uid()` anywhere. Dropping auth loses nothing.
- **Realtime is three `postgres_changes` channels** in `tasks-store.tsx` and `code-store.tsx`,
  there so the Worker's classifier writes appear live. The Worker is going away.
- **Cross-module coupling that matters for the strip:** tasks → code is heavy (gate dialogs, project
  chips, `sendToCode`) and both stay. Tasks → wiki/research is medium: `useWikiConfig()`,
  `useResearchConfigured()` and `lib/tasks/dispatch.ts` gate Inbox menu items. Reader depends hard on
  comms (Gmail intake, health). Code depends on nothing being removed. The shared shell
  (`app/(shell)/layout.tsx` seeds 14 datasets and nests about 22 providers; `lib/modules.ts`,
  `module-router.tsx`, `shell-nav.tsx`, `view-switcher.tsx`, the command palette and global search)
  references every module.
- **The Worker today:** one entrypoint, three routes (`/`, `/github/webhook`, `/comms/ingest`), four
  crons (classifier + comms judge, Gmail poll, Reader tick, daily retention/pricing/wiki sync). The
  only part the fork keeps is the PR-event → factory-state logic in `transitions.ts`,
  `frontmatter.ts` and `github.ts` (fetchSpec), about 750 lines with thorough unit tests.
- **Backups today:** `database/src/backup.ts` runs daily in GitHub Actions, dumps with the Supabase
  CLI, restore-verifies into a throwaway `postgres:17` container and uploads to R2.
- **Tests:** 390 frontend Jest files (91 mock the Supabase server/admin modules), 81 Playwright specs
  against the mock backend, a 6,189-line real-Postgres assertion suite in `database/`, Worker tests
  with a `fetch` stub.

---

## 3. Decisions

Each has a recommendation. The ones marked **confirm** need a word from you before the chunk that
depends on them starts; the rest are made unless you object.

### D1 — Storage: local Postgres + PostgREST (recommended)

Run a Postgres cluster in a persistent data directory using the `cluster.ts` machinery that already
exists, and a **PostgREST** binary in front of it bound to `127.0.0.1`. Point `NEXT_PUBLIC_SUPABASE_URL`
at PostgREST. Nothing in the frontend's data path changes; the migrations apply as they are; `gen-types`
keeps working; the Worker's `fetchJson` helper ports to the runner unchanged.

Why this and not the alternatives:

| Option | App code change | Schema change | Services to run | Verdict |
|---|---|---|---|---|
| **Postgres + PostgREST, native** | ~8 files (auth, realtime) | none | 2 local processes, started by one `npm run dev` | **Recommended.** Smallest change; keeps the SQL where the invariants live. |
| Supabase CLI local stack | none | none | Docker Desktop + ~7 containers | Only if Docker is unrestricted at work. Same app result, heavier machine. |
| SQLite + Drizzle | every route (36 inline, 11 `lib/data`), 19 RPCs, 4 views, both test doubles | rewrite all 56 migrations' plpgsql, triggers, views | 0 | The honest fit for one offline user, and better type safety (schema as code). But it is 8–12 sessions of plumbing before anything new ships, and "tasks as-is" stops being true at the data layer. |

In case you didn't know: a single-user app on Postgres + PostgREST is carrying client/server
architecture it does not need. The reason to carry it anyway is that alfred put its logic in SQL on
purpose and a fork is not the moment to re-home it. The API-route boundary is clean enough that a
later move to SQLite stays possible if the two processes prove irritating.

**Confirm:** your work OS, and whether you can install Postgres (Postgres.app, Homebrew, the EDB
installer on Windows, or the `embedded-postgres` npm package which ships binaries) and download the
PostgREST release binary. If Docker is allowed and the rest is not, swap chunk 1.1 for the Supabase
local stack; everything after 1.1 is identical.

### D2 — Auth: none

Delete the login page, the middleware redirect and the `@supabase/ssr` cookie client. PostgREST is
configured with `db-anon-role = authenticated`, so unauthenticated loopback requests already satisfy
every `to authenticated` policy; the "anon key" becomes any non-empty string. `withSession` and
`requireUser` return a fixed local user so the 46 route handlers that use them do not change. Bind
both PostgREST and Next to loopback.

### D3 — Backups: scheduled `pg_dump`, restore-verified

The runner (D7) takes a custom-format `pg_dump` on startup, every N hours (default 4) and on clean
shutdown, into a configurable directory (default inside the data dir; point it at a synced folder such
as OneDrive for off-machine resilience). Retention: 14 daily, 12 monthly. `npm run restore -w database
-- <file>` restores into the live cluster; `check:slow` restores the latest dump into a throwaway
cluster and runs a smoke query, porting the existing restore-verify step off Docker.

### D4 — Modules: remove reader, comms, wiki and research; keep tasks and code

**Wiki: cut it.** Three reasons. The current wiki is a mirror of a GitHub knowledge repo written by
the Reader's LLM pipeline: its value came from automated intake that the fork will not have. Its
search depends on the one migration with tsvector and generated columns. And the work-knowledge
problem is probably better served by your team's existing GitLab wiki or a plain folder of markdown
than by a bespoke module. Keep the seam cheap: `item_type` keeps a `knowledge` value in the enum until
the baseline squash (chunk 2.5), and the module registry stays data-driven, so a later "notes"
module that points at a local folder slots in as a new module rather than a resurrection.

Removing comms removes the Mac daemon and `/comms/ingest`. Removing reader removes research (it is a
Reader post with `source='research'`), Instapaper and the `routines/` folder.

### D5 — LLM features: none in the app, Copilot CLI for sessions only

The Worker's Inbox classifier (Haiku), the comms judge and the Reader summariser all go. The manual
classification UI stays and is sufficient. The only model access at work is Copilot, so if automatic
classification is wanted later it is a `copilot -p … -s` call from the runner producing JSON (chunk 5.3,
optional). The `code_sessions` cost ledger and `model_price_history` go: Copilot has no per-session
dollar cost to record.

### D6 — Code module domain: Jira keys are the refs

| alfred today | Fork |
|---|---|
| Project = a GitHub repo; 3-letter key; per-project `ref_seq` counter mints `KEY-N` | Project = **one GitLab repo** plus the **Jira project key** whose issues it takes, plus a **local clone path** for sessions. No counter: refs are Jira keys. |
| Epic = local row with a ref from the counter | Epic = a **Jira epic** (parent issue), mirrored with its key. Local-only epics are not allowed; create them in Jira. |
| Story = `items` row + `code_items` sidecar; enters via the gate from the Inbox | Story = the same, with `jira_key`, `jira_status`, `jira_updated_at`, `jira_summary`, `jira_description` columns. Enters via **import** (JQL poll) or via the gate, which in v1 asks for an **existing** Jira key. |
| `factory_state` is the only state | `factory_state` stays local and authoritative for the board. Jira status is displayed, and used only to seed the initial state on import (done in Jira → `done`; anything else → `needs_refinement`). Write-back is chunk 4.8. |
| `refinement_pr_url`, `implementation_pr_url` | Same columns, GitLab MR URLs. |

**Confirm:** Jira Cloud or Jira Data Center? Cloud is `/rest/api/3` with Basic auth (email + API
token) and the new `/search/jql` endpoint (keyset pagination, eventual consistency); Data Center is
`/rest/api/2` with a Bearer PAT. The client is built behind one interface; only your flavour gets
implemented. **Confirm:** does one Jira project map to one repo, or several? The schema allows many
projects per Jira key (a story's repo is chosen at import, defaulting to the project marked default
for that key).

### D7 — Sessions: a local runner process spawns Copilot CLI in worktrees

A new `runner/` workspace (plain Node 24 + TypeScript, modelled on `daemon/`'s shape) runs beside the
dev server and owns everything long-lived: the Jira and GitLab polls, the backup schedule, and a
**job queue** of agent sessions. To launch, the board enqueues a row; the runner claims it, creates a
git worktree on a fresh branch from the default branch, writes the prompt to a file and spawns
`copilot -p "<prompt>" -s --no-ask-user --allow-all-tools` with the worktree as cwd, streaming
stdout/stderr to a log file and recording exit code and timing. One session at a time by default.
Cancel kills the process group.

Why not spawn from a Next route handler: the dev server restarts on edits and crashes, which kills
its children; a route is request-scoped; and alfred already has the separate-process pattern.

The human-in-the-loop affordance stays: the launch button opens the prompt for review and edit before
"Run with Copilot" enqueues it. A "Copy command" fallback prints the exact `copilot` invocation so a
session can be run by hand in a terminal when the runner is down.

Verified flags (GitHub's programmatic-mode reference): `-p` runs one prompt and exits; `-s` strips
decoration; `--no-ask-user` stops clarifying questions; `--allow-tool`/`--allow-all-tools`; `--yolo`
is all three allow-alls. The docs steer toward narrow `--allow-tool` lists outside a sandbox; the
worktree is the sandbox here, but **confirm** with your employer's AI-use policy that unattended CLI
runs are permitted, and pick the tool allowlist in chunk 4.4.

### D8 — Completion signal: poll GitLab for MRs carrying the ticket block

Keep the fenced ```` ```alfred ```` block contract in MR descriptions (`alfred-ticket`, `phase`,
`spec-path`). Every tick, for each project, list MRs with `updated_after` the stored cursor, parse the
block, and feed `(phase, state)` into the ported `transitions.ts` table: GitLab `opened` is the old
`opened`, `merged` is `closed + merged`, `closed` is `closed + !merged`. Spec snapshots come from the
Repository Files API at the merge commit. The optional enforcing check becomes a `.gitlab-ci.yml` job
reading `CI_MERGE_REQUEST_DESCRIPTION`. Branch names carry the Jira key, which also makes GitLab's own
Jira integration link them.

### D9 — Realtime: delete the channels, add a change cursor

Single machine, single tab most of the time: the optimistic stores already reconcile from API
responses. The one out-of-band writer left is the runner (poll results, session status). Chunk 3.2
adds `GET /api/changes?since=<cursor>` backed by `updated_at`, and the two stores poll it every few
seconds while the tab is visible. No websockets.

### D10 — Fork mechanics: hard fork with history, cherry-pick only under `tasks`

Clone with full history into a **private** repo, record the upstream base sha in `FORK.md`, and
never try to keep a mergeable relationship. Upstream commits confined to `components/tasks`,
`components/habits`, `lib/tasks`, `lib/habits`, `components/atoms` may be cherry-picked; anything
touching the shell, data layer or code module is reimplemented. Keep the check gates, husky,
commitlint, migration-lint, secret-scan, showboat, batch-commits and the skill library (Copilot CLI
reads `.claude/skills`, so the skills keep working at work). Drop `tools/session-ledger`, the
cloud-environment docs, and the GitHub Actions that deploy or back up.

### D11 — Secrets and settings

Secrets (`JIRA_*`, `GITLAB_TOKEN`) stay in `.env.local`, loaded by both Next and the runner. Non-secret
configuration that changes without a restart (JQL per project, poll intervals, backup directory, the
default repo per Jira key) lives in the database: project columns plus a small `settings` table.

---

## 4. Target architecture

```
 browser ──► Next.js dev server (127.0.0.1:3000)
                │  route handlers, lib/data readers (supabase-js, unchanged)
                ▼
            PostgREST (127.0.0.1:3001, db-anon-role=authenticated)
                │
                ▼
            Postgres (127.0.0.1:<port>, data dir ./.local/pg, started via cluster.ts)
                ▲
                │  raw fetch to PostgREST (ported workers/src/supabase.ts)
            runner (Node, long-lived)
                ├─ tick: Jira sync, GitLab MR poll → transitions, backup schedule
                └─ executor: claims agent_sessions, `git worktree add`, spawns `copilot -p …`,
                   streams logs to ./.local/sessions/<id>.log
                                    │
                        corporate network: Jira REST, GitLab API v4, Copilot CLI's own auth
```

`npm run dev` at the root starts all four (Postgres, PostgREST, runner, Next) with `concurrently`,
applies pending migrations first, and shuts them down together. `./.local/` is gitignored and holds
the cluster, the PostgREST config, session logs, worktrees and (by default) backups.

### 4.1 Schema changes (code module)

- `projects`: drop `repo_owner`, `repo_name`, `github_url`, `ref_seq`, `cloud_environment`,
  `exclude_from_pr_ratio`, the 3-char `key` check. Add `gitlab_project_path` (`group/sub/repo`, unique),
  `gitlab_project_id int`, `jira_project_key`, `is_default_for_jira_key bool`, `local_repo_path`,
  `default_branch` (default `main`), `jql_override text null`, `mr_cursor timestamptz`.
- `epics`: replace `ref_number`/`ref` with `jira_key` (unique) and add `jira_status`, `jira_updated_at`.
  Drop `create_epic`, `convert_to_code_epic`, `next_code_ref`.
- `code_items`: replace `ref_number`/`ref` with `jira_key` (unique); add `jira_status`,
  `jira_summary`, `jira_description`, `jira_updated_at`, `jira_assignee`, `last_synced_at`. Keep
  `factory_state`, priority columns and their RPCs, `spec_*`, the MR URL columns, `blocked_reason`.
  `enter_code_module` and `create_code_story` take a `jira_key` instead of allocating one.
- `agent_sessions` (replaces `code_sessions`): `id`, `item_id`, `phase`, `status`
  (`queued|running|succeeded|failed|cancelled`), `prompt`, `branch`, `worktree_path`, `log_path`,
  `pid`, `exit_code`, `queued_at`, `started_at`, `finished_at`, `error`.
- `settings`: `key text primary key`, `value jsonb`.
- Removed: everything under `comm_*`, `reader_*`, `wiki_*`, `model_price_history`,
  `classification_corrections` and the classifier triggers, the `knowledge` and `research` enum values
  (at the baseline squash, 2.5).
- Views: `v_code_stories` re-based on the new columns; `task_items` unchanged.

### 4.2 Lifecycle (unchanged states, remapped triggers)

`needs_refinement → in_refinement → ready_for_dev → in_development → ready_for_review → done`, plus
`blocked` and `abandoned`. Trigger mapping:

| Old trigger | Fork trigger |
|---|---|
| Inbox gate with Project + Epic | Import from Jira, or gate with an existing Jira key |
| Click a claude.ai launch link | Review prompt → enqueue an `agent_sessions` row (same state write, awaited) |
| GitHub `pull_request` webhook | Runner's GitLab MR poll producing the same `(phase, action, merged)` |
| Spec snapshot via GitHub Contents API | GitLab Repository Files API at the merge sha |
| Manual controls in the detail modal | Unchanged |

---

## 5. How to size a chunk, and how to brief a session

A chunk is sized for **one Opus 5.5 medium session** when it has: one clear behaviour or one clear
deletion; a file boundary that does not overlap the previous chunk still in flight; existing tests to
lean on or an obvious new test; a demo that can be captured against the running local app; and **no
unresolved decision inside it**. Deletions touch many files but need little judgment, so they are
sized larger in file count than build chunks.

Brief template (paste into the session, replacing the bracketed parts):

```
Read docs/specs/work-fork/SPEC.md fully, then the code it names for chunk [N.N]. Build chunk
[N.N] only. Follow the implement-spec skill, TDD, and the demo-doc workflow. Out of scope:
everything the chunk lists as such, and every later chunk. Open a PR into main with the demo link.
Where SPEC.md is ambiguous for this chunk, choose the simplest reading and record the choice in a
"Decisions made" section of the PR description.
```

Run chunks in order within a phase. Phases 3 and 4 can interleave where the dependency column allows.

---

## 6. Chunks

Legend: **Depends** names chunks that must be merged first. **Done when** is the acceptance bar the
session proves with tests plus a demo doc.

### Phase 1 — Run it offline (2 chunks)

#### 1.1 Local stack: Postgres + PostgREST behind one `npm run dev`

- **Depends:** nothing. Needs D1 confirmed.
- **Build:** `database/src/local-stack.ts` that reuses `cluster.ts` with a **persistent** data dir
  (`./.local/pg`, `initdb` only when absent, fixed port from `.env.local`), applies pending migrations
  through the existing ledger applier, writes `./.local/postgrest.conf` (`db-uri`, `db-schemas=public`,
  `db-anon-role=authenticated`, `server-host=127.0.0.1`, `server-port`), fetches the pinned PostgREST
  release binary for the host OS into `./.local/bin` when missing (checksum-verified), and starts
  both. Root `npm run dev` runs it with `concurrently` next to `next dev`. `frontend/.env.example`
  gains the local defaults. `README.md` gets a "Run locally" section replacing the Supabase steps.
- **Out of scope:** auth, realtime, removing anything. The app will show the login page; log in is
  impossible until 1.2, so the demo is the stack coming up and `curl` against PostgREST.
- **Done when:** fresh clone → `npm ci` → `npm run dev` yields a running stack; a second start reuses
  the data; `gen-types -- --check` still passes; unit tests for the stack script's config writer and
  binary resolver.

#### 1.2 Remove auth

- **Depends:** 1.1. Decision D2.
- **Build:** delete `app/login`, `components/auth`, `middleware.ts`, `lib/supabase/middleware.ts`,
  `lib/auth/actions.ts`. `lib/supabase/server.ts` and `client.ts` become thin `createClient` wrappers
  with the loopback URL and a constant key. `lib/api/auth.ts`'s `withSession`/`requireSession` and
  `lib/auth/require-user.ts` return a fixed local user. Remove the account menu's sign-out. Delete
  `e2e/auth.setup.ts` and the GoTrue half of `mock-supabase.mjs`; fixtures stop using `AUTH_FILE`.
  Update the 91 Jest files that mock these modules only where the mocked shape changed.
- **Done when:** the app opens straight to capture against the local stack; `check` green; demo
  shows capture → task row round-trip persisted across a dev-server restart.

### Phase 2 — Strip (6 chunks)

Serial: every one of these edits `app/(shell)/layout.tsx`, `lib/modules.ts`, `module-router.tsx`,
`shell-nav.tsx`, `view-switcher.tsx`, `command-destinations.tsx` and `search-results.tsx`.

#### 2.1 Remove comms and the Mac daemon

- **Depends:** 1.2.
- **Build:** delete `app/(shell)/(firewall)`, `app/api/comms`, `components/comms`, `lib/comms`,
  `lib/data/comms*.ts`, `lib/api/comms-schemas.ts`, `lib/hooks/use-comms-live.ts`, the two comms
  stores, their Playwright specs and stories, the `daemon/` workspace and `mac-daemon` skill, the
  comms half of `workers/src` and `/comms/ingest`, the comms tables from the e2e mock. Reader imports
  from `lib/comms` (`comms-format`, `accountHealth`, hotkeys, `lib/reader/health.ts`): inline or stub
  them minimally since reader is deleted next. A migration drops the `comm_*` tables and functions.
- **Done when:** `check` green, no `comms` string under `frontend/` except the migration history,
  the shell shows tasks, code, reader, wiki only.

#### 2.2 Remove reader, research, Instapaper and routines

- **Depends:** 2.1.
- **Build:** delete `app/(shell)/(reader)`, `app/api/reader`, `components/reader`, `lib/reader`,
  `lib/instapaper`, `lib/research`, `lib/data/reader*.ts`, `lib/api/reader-schemas.ts`, the three
  reader stores, `scripts/instapaper-token.mjs`, `routines/`, the reader and instapaper Worker code,
  the reader e2e specs and mock endpoints (Instapaper, routine fire). In tasks: remove
  `useResearchConfigured()` and the research branch of `lib/tasks/dispatch.ts`, the Research classification
  option (`lib/tasks/classification.ts`, `inbox-bulk-bar.tsx`), and the `inbox-research` spec. Migration drops `reader_*` tables,
  views and functions and the `send_items_to_research` RPC; the `research` enum value stays until 2.5.
- **Done when:** `check` green; Inbox classification offers task, code, knowledge only.

#### 2.3 Remove wiki

- **Depends:** 2.2. Decision D4.
- **Build:** delete `app/(shell)/(wiki)`, `app/api/wiki`, `components/wiki`, `lib/wiki`,
  `lib/data/wiki.ts`, `lib/api/wiki-schemas.ts`, `wiki-store`, the wiki Worker code and its push-event
  branch, the `WIKI_*` env vars, the GitHub Git Data endpoints of the mock. In tasks: remove
  `useWikiConfig()`, the knowledge branch of `dispatch.ts`, the Knowledge classification option and the
  `inbox-knowledge` spec. Migration drops `wiki_*`. The `knowledge` enum value stays until 2.5.
- **Done when:** `check` green; the shell is tasks ⇄ code; global search covers tasks and stories.

#### 2.4 Remove the Worker package and the LLM classifier

- **Depends:** 2.3. Decision D5.
- **Build:** before deleting, **copy** `workers/src/{transitions,frontmatter,github,supabase}.ts` and
  their tests to `runner/src/legacy/` (kept out of the build until 3.2 wires them; this chunk only
  parks the files so 4.3 does not dig in git history). Then delete `workers/`, `docs/code-module/worker-deploy.md`,
  `.github/workflows/deploy-worker.yml`, the `cloudflare-workers` and `anthropic-api` skills.
  Migration drops `classification_corrections`, the `items_claim_from_classifier` and
  `items_log_classification_corrections` triggers, the classifier hint columns the UI no longer reads
  (`intended_project_id`/`intended_epic_id` stay: the gate uses them), `model_price_history` and the
  `code_session_*`/`model_rates`/`append_model_prices` functions. Remove the live-classify UI
  (`inbox-live-classify` spec, the classifier health affordances). Delete `tools/session-ledger`, the
  `llm-evaluation` skill, `app/api/code/sessions*` and `ledger-inputs`, `LEDGER_API_KEY`.
- **Done when:** root `package.json` workspaces are `frontend`, `database`, `tools/*`; `check` green.

#### 2.5 Baseline migration squash and integration-suite prune

- **Depends:** 2.4.
- **Build:** apply the 60-odd migrations to a throwaway cluster, `pg_dump --schema-only`, and
  hand-clean into a single `0001_baseline.sql` that follows the house conventions (enums first,
  `comment on`, RLS `to authenticated`, grants to `anon, authenticated, service_role`, `security_invoker`
  views) and drops the `knowledge`/`research` enum values and the `supabase_realtime` publication.
  Keep `migrate.ts`'s role bootstrap. Move the old files to `database/migrations/archive/` for `git
  log -S` archaeology, excluded from the applier and from `migration-lint`. Regenerate
  `database.types.ts`. Prune `database/src/assertions.ts` to the kept tables; port any assertion that
  exercised a dropped table. Fresh data dirs start from the baseline; an existing `./.local/pg` from
  Phase 1 is reset (document the one-time `npm run db:reset`).
- **Done when:** `gen-types -- --check` passes, `test:integration` green, baseline applies in under a
  few seconds, migration-lint green.

#### 2.6 Playwright against the real local stack (recommended, can be deferred)

- **Depends:** 2.5.
- **Build:** replace `mock-supabase.mjs` with the real stack on an ephemeral port: `playwright.config.ts`
  starts `local-stack` in test mode (throwaway data dir), PostgREST, then Next. `/__mock__/reset` and
  `/__mock__/seed` become a tiny test-only Node server that `TRUNCATE … CASCADE`s and inserts the
  `SeedState` through PostgREST. Delete the 2,800-line mock and its duplicate RPC logic.
- **Why:** the mock re-implements 19 RPCs and 4 views in JavaScript; every schema change in Phase 4
  would have to be made twice. Doing this first halves the cost of 4.1–4.5.
- **Done when:** all remaining specs pass against the real database; `check:slow` wall time noted in
  the demo.

### Phase 3 — Platform (2 chunks)

#### 3.1 Automatic backups and restore

- **Depends:** 1.1. Decision D3. Can run in parallel with Phase 2.
- **Build:** `database/src/{dump,restore,verify-restore}.ts` using the cluster's `pg_dump`/`pg_restore`
  binaries; a schedule module (startup, interval from `settings`, clean shutdown via `SIGTERM`
  handler) that the local-stack script runs until 3.2 moves it into the runner; retention pruning;
  `npm run backup`, `npm run restore -- <file>`, `npm run backup:verify` (restores the newest dump into
  a throwaway cluster via `cluster.ts` and runs a row-count smoke query); `check:slow` runs
  `backup:verify`. Replace `backup.ts`'s Supabase CLI and R2 paths; delete `.github/workflows/backup.yml`.
- **Done when:** dumps appear on the schedule and on shutdown, pruning works (unit-tested with a fake
  clock and fake fs), and a restore of a dump taken after a capture brings the capture back (demo).

#### 3.2 Runner skeleton and the change cursor (replaces realtime)

- **Depends:** 2.4, 3.1. Decision D7, D9.
- **Build:** `runner/` workspace (tsconfig strictest, jest, eslint like `daemon/` had) with: env
  loading from `frontend/.env.local`; a tick loop with per-job intervals and a `runner_health` row
  (`last_tick_at`, `last_error`); the backup schedule moved in from 3.1; the ported PostgREST
  `fetchJson` client from `runner/src/legacy/supabase.ts`; graceful shutdown. Root `npm run dev` adds
  it. Frontend: `GET /api/changes?since=` returning changed `items`/`code_items`/`epics` ids by
  `updated_at`; `tasks-store` and `code-store` drop their Supabase channels and
  `lib/supabase/realtime.ts`, and poll the cursor every 3 s while `document.visibilityState ===
  'visible'`. A small runner status chip in the shell reads `runner_health`.
- **Done when:** a row updated by `psql` shows up in the open tab within one poll; the runner
  survives a dev-server restart; unit tests for the tick scheduler and the cursor route.

### Phase 4 — Code module overhaul (8 chunks)

#### 4.1 Domain migration: Jira keys, GitLab projects, agent sessions

- **Depends:** 2.5. Decision D6.
- **Build:** the §4.1 migration (new baseline-numbered `0002_work_code_module.sql`); regen types; update
  `lib/api/schemas.ts`, `lib/types.ts`, `lib/data/code.ts`, the code store and `api-client.ts` for the
  renamed columns; the gate dialog asks for a Jira key (validated `^[A-Z][A-Z0-9_]+-\d+$`) instead of
  allocating one; the new-project dialog takes GitLab path, Jira key, local clone path, default branch;
  remove the epic-creation dialog and `convert_to_code_epic`; `story-ref` atom renders the Jira key
  and links to `JIRA_BASE_URL/browse/<key>`. Delete `lib/code/links.ts`, `launch.ts`, `github.ts`,
  `lib/github/*`, `project-prefix.ts` and their tests; leave the launch buttons rendering disabled
  with a "coming in 4.5" tooltip so the board stays usable.
- **Done when:** a project and a story with a hand-entered key appear on the board; priority
  drag-and-drop still works (its RPCs are unchanged); `check` green.

#### 4.2 Jira client and read sync

- **Depends:** 3.2, 4.1. Confirm Cloud vs Data Center and the one-repo-per-key question first.
- **Build:** `runner/src/jira/` with a typed client (your flavour), a sync job: per project run the
  JQL (default `project = <KEY> AND assignee = currentUser() AND statusCategory != Done`, overridable in
  `projects.jql_override`), upsert epics from parents and stories from issues (create `items` +
  `code_items` via a new `import_code_story` RPC; refresh `jira_*` columns on existing rows; never
  touch `factory_state` after import), cursor on `updated >= last_synced_at`. Description stored as the
  rendered plain text (Cloud: extract text from ADF; DC: strip wiki markup) with the raw kept in a
  `jira_description_raw jsonb`. Settings UI: a Jira section on the project header showing last sync,
  count, errors, and a "Sync now" button that flips a `settings.sync_requested` flag the runner honours
  on its next tick.
- **Done when:** with a token in `.env.local` and a sandbox Jira project, issues land on the board
  in the right epics within one tick; tests use recorded JSON fixtures (scrubbed of anything work-specific).

#### 4.3 GitLab client, MR poll and state transitions

- **Depends:** 4.2. Decision D8.
- **Build:** `runner/src/gitlab/` typed client (API v4, `PRIVATE-TOKEN`); a poll job per project
  listing MRs `updated_after` `projects.mr_cursor`, parsing the ```` ```alfred ```` block with the parked
  `frontmatter.ts`, mapping GitLab state to `(action, merged)` and applying the parked `transitions.ts`
  (unchanged logic, including spike and bug phases), writing MR URLs, snapshotting the spec through the
  Repository Files API (ported `github.ts`'s fetchSpec). Idempotent on re-poll (compare `updated_at`).
  Board cards show the MR chip (`review-pr-chip` atom renamed).
- **Done when:** the full transition table has unit coverage against GitLab-shaped fixtures; an MR
  opened and merged in a sandbox GitLab project moves a story `in_refinement → ready_for_dev` with the
  spec rendered in the detail modal.

#### 4.4 Copilot session executor

- **Depends:** 3.2, 4.1. Confirm the tool allowlist policy.
- **Build:** `runner/src/sessions/`: claim the oldest `queued` row (one running at a time, configurable),
  `git -C <local_repo_path> fetch` then `git worktree add ./.local/worktrees/<key>-<phase>-<id> -b
  <branch> origin/<default_branch>`, write `prompt.md`, spawn `copilot` with the D7 flags and the
  allowlist from `settings`, pipe output to `./.local/sessions/<id>.log`, record `pid`, `started_at`,
  exit code, `finished_at`, `status`; timeout from `settings` (default 90 min); cancel by killing the
  process group when a row flips to `cancelled`; worktree pruning for finished sessions after N days.
  Branch naming `<KEY>-<phase>-<slug>` so GitLab's Jira integration links it. Frontend: `POST
  /api/code/sessions` (enqueue), `PATCH …/cancel`, `GET …/:id/log?offset=` (tail). No UI yet beyond
  routes.
- **Done when:** enqueuing a row through the API against a scratch repo produces a worktree, a log
  and a terminal status; the spawner is unit-tested with a fake `copilot` script; a demo shows a
  trivial prompt completing end to end.

#### 4.5 Launch UI and session panel

- **Depends:** 4.3, 4.4.
- **Build:** re-enable the launch buttons: refinement, implementation, spike, bug and
  skip-to-development, each opening a **prompt review dialog** (prompt built by a ported
  `lib/code/prompts.ts`, editable, with the exact `copilot` command behind a "Copy command" button),
  whose "Run with Copilot" awaits the factory-state write then enqueues. A **session panel** in the
  detail modal lists sessions with status, duration, branch, a live log tail (polling the log route
  while running), cancel, and "Open worktree" (copies the path). Board cards show a running-session
  indicator.
- **Done when:** the e2e suite covers launch → queued → running → finished with the fake `copilot`;
  storybook snapshots for the dialog and panel; demo doc screenshots.

#### 4.6 Prompts, skills and the project-repo kit

- **Depends:** 4.5.
- **Build:** rewrite the five prompts for Copilot: reference the Jira key and Jira description, name
  the spec path `docs/specs/<KEY>.md`, require the MR description block, keep the guardrails
  (ground in the repo, clarification gate becomes "stop and write questions into the MR description"
  since no human is in the loop mid-run, verbatim self-check). `docs/code-module/repo-setup/` becomes
  a kit a work repo copies in: `AGENTS.md`/`.github/copilot-instructions.md` template, the
  refinement/implement/spike/bug skills under `.claude/skills/` (Copilot CLI reads that folder;
  verify `.github/skills` too and pick one), the optional `.gitlab-ci.yml` include that fails an MR
  missing the block. Remove the `alfred-frontmatter.yml` GitHub Action.
- **Done when:** prompt builders are snapshot-tested; the kit is exercised by the demo against a
  scratch GitLab repo.

#### 4.7 Dashboard

- **Depends:** 4.3.
- **Build:** replace the GitHub PR-ratio and lines-changed cards with GitLab equivalents (merged MRs
  per project per week; lines changed via MR `changes_count`/commit stats), or remove the cards if the
  GitLab API cost is not worth it. Remove `PR_RATIO_AUTHORS`. Add a sessions card: runs per week,
  success rate, median duration.
- **Done when:** the dashboard renders with no 501 placeholders; cards unit-tested with fixtures.

#### 4.8 Jira write-back (optional)

- **Depends:** 4.2, 4.5.
- **Build:** on `factory_state` transitions, optionally transition the Jira issue (mapping in
  `settings`, default off), post a comment with the MR link when an MR opens, and let the gate
  **create** a Jira issue from an Inbox capture. Each write is a runner job with retry and an error
  surface on the story card.
- **Done when:** a story moving to `ready_for_review` comments on the sandbox issue; mapping
  unit-tested; every write is off by default.

### Phase 5 — Polish (3 chunks)

#### 5.1 Docs, CLAUDE.md and skill library for the fork

- **Depends:** Phase 4.
- **Build:** rewrite `README.md` (prerequisites: Node 24, Postgres, tokens; run; backups; restore),
  `CLAUDE.md` (monorepo at a glance; remove Vercel/Supabase/Workers rules; add the runner and the
  "never work-specific" rule), `docs/specs/product/SPEC.md` becomes the fork's product spec with this
  document folded in, archive the upstream code-module spec. Prune skills that name removed tools
  (`supabase` → `postgrest-local`, `nextjs` loses Vercel, `gh-cli` → `gitlab-cli` if `glab` is used,
  `git` keeps). Run `skill-lint`.
- **Done when:** a fresh reader can set up and run the fork from the README alone; `lint:skills` green.

#### 5.2 Dead tooling and CI

- **Depends:** 5.1.
- **Build:** delete `.github/workflows/{migrate,deploy-worker,backup}.yml`, `scripts/cloud-setup.sh`,
  `docs/cloud-environment.md`, `frontend/scripts/snapshot-docker.mjs`
  **if** Docker is unavailable at work (then snapshots run natively with a Linux-only CI baseline, or
  the snapshot gate moves to CI only). `ci.yml` runs `check` on the personal GitHub fork.
- **Done when:** CI green on the fork; no reference to Vercel, Supabase, Cloudflare, Anthropic or
  GitHub Actions deploys remains outside `docs/specs/archive`.

#### 5.3 Inbox classification via Copilot (optional)

- **Depends:** 3.2, 2.4.
- **Build:** a runner job that batches `unclassified` items and asks `copilot -p … -s` for JSON
  (`{item_type, folder_hint, project_hint}`) with a strict schema check and the same
  claim/correction semantics the old classifier had, re-adding the live-classify UI behind a setting.
- **Done when:** fixtures of model output drive unit tests; the job is off by default.

---

## 7. Open questions for you

Only the ones that change what gets built:

1. **D1:** Work OS, and which of Postgres install / PostgREST binary download / Docker Desktop are
   permitted there. (Blocks 1.1.)
2. **D6:** Jira **Cloud or Data Center**? One Jira project per repo, or many repos per project?
   (Blocks 4.2.)
3. **D7:** Is unattended `copilot -p` with `--allow-all-tools` acceptable under your employer's
   policy, or must the allowlist be narrow (`--allow-tool shell(git)` and so on)? (Blocks 4.4.)
4. **D4:** Agree to cut wiki with the seam described? If not, the replacement is a "notes" module over
   a local markdown folder and is its own phase, not a port of the current one.
5. **D10:** Name of the fork repo (private), so the fenced block tag and the `.local/` directory can
   be named for it instead of `alfred`.

Everything else in §3 proceeds as recommended unless you say otherwise.

---

## 8. Appendix

### 8.1 External facts this plan relies on

- **Copilot CLI programmatic mode:** `-p`/`--prompt` runs one prompt non-interactively and exits; `-s`
  prints only the response; `--no-ask-user`; `--allow-tool`, `--allow-url`, `--allow-all-tools`,
  `--yolo`. Skills are read from `.github/skills`, `.claude/skills` or `.agents/skills` in the repo and
  `~/.copilot/skills` personally; custom agents are `.github/agents/*.agent.md` (verify against current
  docs when 4.6 starts; the CLI changes quickly).
- **Jira Cloud search:** `GET/POST /rest/api/3/search/jql` replaced `/rest/api/3/search` (removed
  May 2025). Keyset pagination via `nextPageToken`, no total count, eventual consistency for new
  issues. Rich text is ADF in v3.
- **GitLab API v4:** `GET /projects/:id/merge_requests?updated_after=&state=all&order_by=updated_at`,
  `GET /projects/:id/repository/files/:path/raw?ref=`, `PRIVATE-TOKEN` header. Predefined CI variable
  `CI_MERGE_REQUEST_DESCRIPTION` for the optional enforcing job.
- **PostgREST:** single static binary per OS from the GitHub releases page; one config file;
  `db-anon-role` sets the role unauthenticated requests run as.

### 8.2 Session count and order at a glance

| Phase | Chunks | Can parallelise |
|---|---|---|
| 1 Offline | 1.1, 1.2 | no |
| 2 Strip | 2.1 → 2.6 | no (shared shell files) |
| 3 Platform | 3.1, 3.2 | 3.1 alongside Phase 2 |
| 4 Code | 4.1 → 4.8 | 4.2 ∥ 4.4 after 4.1; 4.7 ∥ 4.5 |
| 5 Polish | 5.1 → 5.3 | 5.3 any time after 3.2 |

22 chunks, of which 2.6, 4.8 and 5.3 are optional. A realistic first useful milestone (offline tasks
app with backups) is after 1.1, 1.2 and 3.1: three sessions.
