# Work fork of alfred — spec and chunked build plan

> **Status:** Planning spec, ready to drive implementation sessions.
> **Audience:** The owner, and the Claude Code sessions (Opus 5.5, medium effort) that build the fork
> one chunk at a time.
> **Scope:** What the fork is, the decisions that shape it (with the recommended answer to each open
> question), the target architecture, and an ordered list of chunks each sized for one session.
> **Not in scope:** Per-chunk specs. Each chunk is refined in its own session from the brief in §5.
> **Revision:** D1 was first written as local Postgres + PostgREST. It was changed to SQLite before any
> chunk started, once the delta was costed at about five sessions rather than the whole rewrite, and
> once the Postgres path's one hard dependency (installing Postgres and PostgREST at work) was weighed.

---

## 0. Summary

A private fork of alfred that runs **entirely on one work machine** from a dev server: Next.js over a
**single SQLite file** through Drizzle, with a small long-running **runner** process that replaces the
Cloudflare Worker. The **tasks** module keeps its behaviour exactly; its data plumbing is rewritten
underneath it. The **reader, comms, wiki and research** modules, the Mac daemon, the Cloudflare Worker,
Supabase and every Anthropic call are removed. The **code** module keeps its refine → implement
lifecycle and board but is re-pointed at **Jira** (tickets), **GitLab** (merge requests) and the
**GitHub Copilot CLI** (sessions that run locally in git worktrees, launched from the board). Backups
are automatic `VACUUM INTO` snapshots to a folder you choose.

The plan is 23 chunks in five phases. The strip runs first against the test suites, then the data
layer moves to SQLite table-group by table-group with the old and new layers coexisting, so every
chunk lands green. The app first runs offline at the end of Phase 2.

---

## 1. Requirements, restated with the interpretation this plan builds

| # | You said | This plan reads it as |
|---|---|---|
| R1 | Completely offline, run from a dev server, data on the machine, framework-agnostic, keep end-to-end type safety, automatic backups | No cloud service and no second server process in the runtime path. "Offline" means the **app** never needs the internet; the code module still calls your company's Jira and GitLab, which are on the corporate network. Type safety becomes schema-as-code: Drizzle infers row types, Zod request schemas derive from them, the typed API client and stores stay. Backups are scheduled, local, restorable, and verified by a check. |
| R2 | Tasks as-is; code overhauled; reader, wiki, comms removed; wiki undecided | Tasks is untouched in behaviour. Its route handlers and data readers are rewritten against SQLite, and its dispatch hooks into wiki and research are removed. Wiki is **cut** in this plan, with the reasoning in D4 and a cheap way back. |
| R3.1–3.2 | Copilot, not Claude Code; no cloud sessions; Copilot CLI may be triggered programmatically | Sessions run **on the machine** as Copilot CLI processes in git worktrees, started and tracked by the runner. The "human reviews the prompt before anything runs" affordance is kept. |
| R3.3 | GitLab, not GitHub | Merge requests are the completion signal. No inbound webhook is possible on a laptop, so the runner **polls** GitLab. |
| R3.4 | Jira tracks tickets | Jira is the **system of record** for a ticket's existence, key, title, description and status. The fork mirrors a JQL-selected set and layers its own factory state, ordering, notes, MR links and sessions on top. |
| R3.5 | You can mint Jira and GitLab tokens | Tokens live in `.env.local` only, like every secret in alfred today. |

**A constraint you did not state but the plan depends on:** the fork is developed on your personal
account (Claude Code needs GitHub) and then cloned at work. So the repo must be **work-shaped but
never work-specific**: no Jira host, project keys, repo paths, names or ticket text in any committed
file. Everything like that lives in `.env.local` or in the local database.

**A second one:** nothing in the fork's install may depend on downloading a native binary at `npm
install` time. Corporate proxies block that routinely, and it is the reason D1 prefers Node's built-in
SQLite over a package with a prebuilt native module.

---

## 2. What the codebase actually looks like (the facts the decisions rest on)

Verified against the repo in this session:

- **Every data access speaks the PostgREST wire protocol.** The frontend uses supabase-js (postgrest-js)
  through `frontend/lib/supabase/server.ts`; the Worker uses raw `fetch` against `/rest/v1`
  (`workers/src/supabase.ts`); the Playwright suite runs the real Next server against an in-memory
  PostgREST emulation (`frontend/scripts/mock-supabase.mjs`, 2,856 lines) that re-implements 19 RPCs
  and 4 views in JavaScript.
- **Business invariants live in SQL, not app code.** 56 migrations, about 76 plpgsql functions,
  10 triggers, 9 views, 8 enums, recursive CTEs for subtrees and recurrence, advisory locks for
  priority swaps. After the strip, the kept modules own about **11 functions, 7 triggers, 4 CHECK
  constraints, 2 views and 8 frontend RPCs**; three of those functions (`next_code_ref`,
  `create_epic`, `convert_to_code_epic`) are deleted by the Jira redesign anyway.
- **Auth is a login page plus role-based RLS with no per-user scoping.** Every policy is
  `to authenticated`; there is no `auth.uid()` anywhere. Dropping auth loses nothing.
- **Realtime is three `postgres_changes` channels** in `tasks-store.tsx` and `code-store.tsx`,
  there so the Worker's classifier writes appear live. The Worker is going away. `items` has no
  `updated_at` column today; `code_items` and `habits` do.
- **The repo already uses Node's built-in SQLite.** `daemon/src/sources/imessage/chat-db.ts` imports
  `DatabaseSync` from `node:sqlite` to read Messages.app's database. `.nvmrc` pins Node 24.
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
- **Tests:** 390 frontend Jest files, of which 91 mock the Supabase server/admin modules and 76 use
  `lib/api/supabase-route-double.ts`; 81 Playwright specs against the mock backend; a 6,189-line
  real-Postgres assertion suite in `database/src/assertions.ts` that is the written-down spec of the
  SQL invariants; Worker tests with a `fetch` stub. 55 route handlers in all: 25 call Supabase
  inline, 19 only through `lib/data/*`, 11 both; 46 use `withSession`.
- **No data migration is needed.** The work fork starts empty.

---

## 3. Decisions

Each has a recommendation. The ones marked **confirm** need a word from you before the chunk that
depends on them starts; the rest are made unless you object.

### D1 — Storage: one SQLite file, Drizzle ORM, Node's built-in driver

The database is a single file at `./.local/<fork>.sqlite` in WAL mode, opened by the Next server and
the runner (two processes on one file is what WAL is for; set `busy_timeout`). The schema is
TypeScript in a new `db/` workspace using Drizzle; `drizzle-kit generate` emits SQL migrations that
`drizzle-orm`'s migrator applies at startup. Row types are inferred (`$inferSelect`/`$inferInsert`);
request schemas derive from them with `drizzle-zod` where the shape is a row, and stay hand-written
where it is not. The plpgsql functions, triggers and CHECK constraints become TypeScript functions in
`db/src/domain/*` that run inside a transaction; with a single writer, the advisory locks become plain
transactions.

**Driver:** prefer `node:sqlite` (Node 24, no native download, already used by the daemon). Chunk 2.1
verifies that the pinned Drizzle version has a `node:sqlite` driver; if it does not, fall back to
`better-sqlite3` **with its prebuilt binary vendored into the repo**, never fetched at install time.
Verify `node:sqlite`'s stability flag on Node 24 at the same time and record both in the chunk's PR.

**Type mapping:** UUIDs are `text` minted with `crypto.randomUUID()`; `timestamptz` is ISO-8601 text
with a `Z` suffix (lexicographic order is chronological); `date` is `YYYY-MM-DD` text; booleans are
integers via Drizzle's `{ mode: 'boolean' }`; enums are `text` with a CHECK and a TypeScript union;
`jsonb` is `text` with `{ mode: 'json' }`.

Why this and not the alternatives considered:

| Option | App code change | Schema change | Processes | Install at work | Verdict |
|---|---|---|---|---|---|
| **SQLite + Drizzle** | ~30 routes, 5 `lib/data` files, ~100 test files re-platformed | all plpgsql/triggers/CHECKs → TypeScript | 0 extra | nothing to install | **Chosen.** About five sessions more than the Postgres path; removes every external dependency and the second wire protocol; one file to back up; schema-as-code types. |
| Postgres + PostgREST, native | ~8 files | none | 2 | Postgres server + PostgREST binary | Cheapest to reach, but its one hard dependency is exactly the thing work may refuse, and "migrate to SQLite later" never happens once the app works. |
| Supabase CLI local stack | none | none | Docker + ~7 containers | Docker Desktop | Same objection, heavier. |

**What SQLite keeps that you might expect to lose:** recursive CTEs, JSON functions, views, triggers,
generated columns, `RETURNING`. What it drops and where it goes: enums (CHECK constraints), server-side
UUIDs (app), RLS and roles (not needed), advisory locks (a transaction), `security_invoker` views (not
needed), full-text search (wiki is cut).

### D2 — Auth: none

Delete the login page, the middleware redirect and the `@supabase/ssr` cookie client. `withSession`
is replaced by `withDb`, which hands a route handler `{ db }` and nothing else; `requireUser` returns a
fixed local user wherever a Server Component still wants one. Next binds to loopback.

### D3 — Backups: scheduled `VACUUM INTO`, restore-verified

The runner (D7) runs `VACUUM INTO '<backup dir>/<fork>-<timestamp>.sqlite'` on startup, every N hours
(default 4) and on clean shutdown, into a configurable directory (default `./.local/backups`; point it
at a synced folder such as OneDrive for off-machine resilience). Retention: 14 daily, 12 monthly.
`npm run restore -w db -- <file>` swaps the file in after checking `PRAGMA integrity_check`;
`check:slow` opens the newest backup read-only, runs `integrity_check` and a row-count smoke query.
Until the runner exists (Phase 3), the Next server's `instrumentation.ts` runs the startup snapshot.

### D4 — Modules: remove reader, comms, wiki and research; keep tasks and code

**Wiki: cut it.** Three reasons. The current wiki is a mirror of a GitHub knowledge repo written by
the Reader's LLM pipeline: its value came from automated intake that the fork will not have. Its
search depends on the one migration with tsvector and generated columns. And the work-knowledge
problem is probably better served by your team's existing GitLab wiki or a plain folder of markdown
than by a bespoke module. Keep the seam cheap: the module registry stays data-driven, so a later
"notes" module that points at a local folder slots in as a new module rather than a resurrection.

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
**job queue** of agent sessions. It opens the same SQLite file through the `db/` package; there is no
HTTP between the runner and the data. To launch, the board enqueues a row; the runner claims it,
creates a git worktree on a fresh branch from the default branch, writes the prompt to a file and
spawns `copilot -p "<prompt>" -s --no-ask-user --allow-all-tools` with the worktree as cwd, streaming
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
responses. The one out-of-band writer left is the runner (poll results, session status). Every table
the stores hold gets an `updated_at` column maintained by the domain layer (items, folders and epics
lack one today). Chunk 3.1 adds `GET /api/changes?since=<cursor>` over it, and the two stores poll it
every few seconds while the tab is visible. No websockets.

### D10 — Fork mechanics: hard fork with history, cherry-pick only under `tasks`

Clone with full history into a **private** repo, record the upstream base sha in `FORK.md`, and
never try to keep a mergeable relationship. Upstream commits confined to `components/tasks`,
`components/habits`, `components/atoms`, `lib/tasks` and `lib/habits` may be cherry-picked; anything
touching the shell, the data layer or the code module is reimplemented. Keep the check gates, husky,
commitlint, secret-scan, showboat, demo-lint, check-scope, batch-commits and the skill library
(Copilot CLI reads `.claude/skills`, so the skills keep working at work). Drop `tools/session-ledger`,
`tools/migration-lint` (it lints Postgres grants), the `database/` workspace, the cloud-environment
docs, and the GitHub Actions that deploy or back up.

### D11 — Secrets and settings

Secrets (`JIRA_*`, `GITLAB_TOKEN`) stay in `.env.local`, loaded by both Next and the runner. Non-secret
configuration that changes without a restart (JQL per project, poll intervals, backup directory, the
default repo per Jira key, the Copilot tool allowlist) lives in the database: project columns plus a
small `settings` table.

---

## 4. Target architecture

```
 browser ──► Next.js dev server (127.0.0.1:3000)
                │  route handlers + lib/data readers → db/ (Drizzle)
                ▼
            ./.local/<fork>.sqlite  (WAL mode, one file)
                ▲
                │  db/ (same package, same file)
            runner (Node, long-lived)
                ├─ tick: Jira sync, GitLab MR poll → transitions, VACUUM INTO backups
                └─ executor: claims agent_sessions, `git worktree add`, spawns `copilot -p …`,
                   streams logs to ./.local/sessions/<id>.log
                                    │
                        corporate network: Jira REST, GitLab API v4, Copilot CLI's own auth
```

`npm run dev` at the root runs pending migrations, then starts the runner and `next dev` with
`concurrently`, and shuts both down together. `./.local/` is gitignored and holds the database, its
WAL files, session logs, worktrees and (by default) backups.

### 4.1 The `db/` workspace

- `src/schema/*.ts` — one file per table group (`items`, `folders`, `weekly-plans`, `habits`,
  `projects`, `epics`, `code-items`, `agent-sessions`, `settings`), plus `views.ts` for `task_items`
  and `v_code_stories` as Drizzle views.
- `src/domain/*.ts` — the ported SQL logic: `completeSubtree`, `completeAndSpawn`, `getSubtree`,
  `createWeeklyPlanItems`, `enterCodeModule`, `createCodeStory`, `swapCodePriority`,
  `moveCodePriority`, `moveCodePriorityInProject`, `respaceCodePriorities`, and the former triggers
  and CHECKs as `assertSubtaskShape`, `inheritDispatchedAt`, `returnItemsToInbox`,
  `clearDueTimeWithDate`, `stampDoneAt`, `stampPriorityRev`, `assertIntendedEpicProject`,
  `assertTaskOnlyFields`, `assertDispatchedNeedsFolder`. Each runs inside `db.transaction`.
- `src/open.ts` — `openDb(path)` (WAL, `busy_timeout`, foreign keys on, migrate) and
  `openTestDb()` (`:memory:`, migrated), the latter the backbone of every route and domain test.
- `migrations/` — `drizzle-kit generate` output, committed verbatim, applied by the migrator.
- `src/backup.ts`, `src/restore.ts`, `src/verify-backup.ts` (D3).

### 4.2 Schema changes for the code module (Phase 4, on top of the ported schema)

- `projects`: drop `repo_owner`, `repo_name`, `github_url`, `ref_seq`, `cloud_environment`,
  `exclude_from_pr_ratio`, the 3-char `key` check. Add `gitlab_project_path` (`group/sub/repo`, unique),
  `gitlab_project_id`, `jira_project_key`, `is_default_for_jira_key`, `local_repo_path`,
  `default_branch` (default `main`), `jql_override`, `mr_cursor`.
- `epics`: replace `ref_number`/`ref` with `jira_key` (unique) and add `jira_status`, `jira_updated_at`.
  Delete the ported `createEpic`, `convertToCodeEpic`, `nextCodeRef`.
- `code_items`: replace `ref_number`/`ref` with `jira_key` (unique); add `jira_status`,
  `jira_summary`, `jira_description`, `jira_description_raw` (json), `jira_updated_at`,
  `jira_assignee`, `last_synced_at`. Keep `factory_state`, priority columns and their domain
  functions, `spec_*`, the MR URL columns, `blocked_reason`. `enterCodeModule` and `createCodeStory`
  take a `jira_key` instead of allocating one.
- `agent_sessions` (replaces `code_sessions`): `id`, `item_id`, `phase`, `status`
  (`queued|running|succeeded|failed|cancelled`), `prompt`, `branch`, `worktree_path`, `log_path`,
  `pid`, `exit_code`, `queued_at`, `started_at`, `finished_at`, `error`.
- `settings`: `key text primary key`, `value json`.
- `runner_health`: `id`, `last_tick_at`, `last_error`.

### 4.3 Lifecycle (unchanged states, remapped triggers)

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

A chunk is sized for **one Opus 5.5 medium session** when it has: one clear behaviour, one clear
deletion, or one table group's port; a file boundary that does not overlap the previous chunk still in
flight; existing tests to lean on or an obvious new test; a demo (a test run, or a screenshot once the
app runs); and **no unresolved decision inside it**. Deletions touch many files but need little
judgment, so they are sized larger in file count than build chunks.

**The coverage guard, binding on every Phase 2 chunk.** Re-platforming a route from the Supabase
double to `openTestDb()` is where a session can quietly weaken the regression net while reporting
green. So each port chunk records in its PR the Jest **assertion count** for the files it touched,
before and after, and the count may not fall. Every invariant in `database/src/assertions.ts` that
exercises a table the chunk ports is re-expressed as a test of the corresponding `db/src/domain`
function before the SQL is deleted. Mocks of the data layer are not allowed in the ported tests: a
route test runs the real handler against an in-memory database.

Brief template (paste into the session, replacing the bracketed parts):

```
Read docs/specs/work-fork/SPEC.md fully, then the code it names for chunk [N.N]. Build chunk
[N.N] only. Follow the implement-spec skill, TDD, and the demo-doc workflow. Out of scope:
everything the chunk lists as such, and every later chunk. Open a PR into main with the demo link.
Where SPEC.md is ambiguous for this chunk, choose the simplest reading and record the choice in a
"Decisions made" section of the PR description. For a Phase 2 chunk, report the before/after
assertion counts the coverage guard in §5 asks for.
```

Run chunks in order within a phase. Phases 3 and 4 can interleave where the dependency column allows.

---

## 6. Chunks

Legend: **Depends** names chunks that must be merged first. **Done when** is the acceptance bar the
session proves with tests plus a demo doc. Until the end of Phase 2 the app does not run, so a
demo is the relevant test run and, for the strip, the shell rendering in Storybook.

### Phase 1 — Strip (4 chunks)

Serial: every one of these edits `app/(shell)/layout.tsx`, `lib/modules.ts`, `module-router.tsx`,
`shell-nav.tsx`, `view-switcher.tsx`, `command-destinations.tsx` and `search-results.tsx`. The
Supabase layer, the e2e mock and the login flow stay in place through this phase; only the modules go.

#### 1.1 Remove comms and the Mac daemon

- **Depends:** nothing.
- **Build:** delete `app/(shell)/(firewall)`, `app/api/comms`, `components/comms`, `lib/comms`,
  `lib/data/comms*.ts`, `lib/api/comms-schemas.ts`, `lib/hooks/use-comms-live.ts`, the two comms
  stores, their Playwright specs and stories, the `daemon/` workspace and `mac-daemon` skill, the
  comms half of `workers/src` and `/comms/ingest`, the comms tables from the e2e mock. Reader imports
  from `lib/comms` (`comms-format`, `accountHealth`, hotkeys, `lib/reader/health.ts`): inline or stub
  them minimally since reader is deleted next. A migration drops the `comm_*` tables and functions and
  the Postgres assertions for them go.
- **Done when:** `check` green, no `comms` string under `frontend/` except the migration history,
  the shell shows tasks, code, reader, wiki only.

#### 1.2 Remove reader, research, Instapaper and routines

- **Depends:** 1.1.
- **Build:** delete `app/(shell)/(reader)`, `app/api/reader`, `components/reader`, `lib/reader`,
  `lib/instapaper`, `lib/research`, `lib/data/reader*.ts`, `lib/api/reader-schemas.ts`, the three
  reader stores, `scripts/instapaper-token.mjs`, `routines/`, the reader and instapaper Worker code,
  the reader e2e specs and mock endpoints (Instapaper, routine fire). In tasks: remove
  `useResearchConfigured()` and the research branch of `lib/tasks/dispatch.ts`, the Research
  classification option (`lib/tasks/classification.ts`, `inbox-bulk-bar.tsx`), and the
  `inbox-research` spec. Migration drops `reader_*` tables, views and functions and
  `send_items_to_research`.
- **Done when:** `check` green; Inbox classification offers task, code, knowledge only.

#### 1.3 Remove wiki

- **Depends:** 1.2. Decision D4.
- **Build:** delete `app/(shell)/(wiki)`, `app/api/wiki`, `components/wiki`, `lib/wiki`,
  `lib/data/wiki.ts`, `lib/api/wiki-schemas.ts`, `wiki-store`, the wiki Worker code and its push-event
  branch, the `WIKI_*` env vars, the GitHub Git Data endpoints of the mock. In tasks: remove
  `useWikiConfig()`, the knowledge branch of `dispatch.ts`, the Knowledge classification option and the
  `inbox-knowledge` spec. Migration drops `wiki_*`.
- **Done when:** `check` green; the shell is tasks ⇄ code; global search covers tasks and stories.

#### 1.4 Remove the Worker package, the LLM classifier and the session ledger

- **Depends:** 1.3. Decision D5.
- **Build:** before deleting, **copy** `workers/src/{transitions,frontmatter,github}.ts` and their
  tests to `runner/src/legacy/` (kept out of any build until 4.3 wires them; this chunk only parks
  the files). Then delete `workers/`, `docs/code-module/worker-deploy.md`,
  `.github/workflows/deploy-worker.yml`, the `cloudflare-workers` and `anthropic-api` skills.
  Migration drops `classification_corrections`, the `items_claim_from_classifier` and
  `items_log_classification_corrections` triggers, `model_price_history` and the
  `code_session_*`/`model_rates`/`append_model_prices`/`record_code_session`/`upsert_code_sessions`
  functions and `code_sessions`. `intended_project_id`/`intended_epic_id` stay: the gate reads them.
  Remove the live-classify UI (`inbox-live-classify` spec, classifier health affordances). Delete
  `tools/session-ledger`, the `llm-evaluation` skill, `app/api/code/sessions*`, `ledger-inputs`,
  `LEDGER_API_KEY`.
- **Done when:** root workspaces are `frontend`, `database`, `tools/*`; `check` green.

### Phase 2 — SQLite data layer (6 chunks)

The old and new layers **coexist** through this phase. A route is either on Supabase or on `db/`,
never both. The e2e harness keeps running the mock for unported tables and, from 2.1, writes ported
tables into a test SQLite file, so `check:slow` stays green at every chunk. Ports go by table group,
because `items` is shared by tasks and code and must move once.

#### 2.1 The `db/` spine: schema, driver, test database, `withDb`, e2e bridge

- **Depends:** 1.4. Decision D1, D2.
- **Build:** the `db/` workspace with the Drizzle schema for **every kept table as it stands today**
  (translated column for column per the D1 type mapping, enums as CHECKs, both views), the driver
  decision recorded (D1), `openDb`/`openTestDb`, the migrator, the first generated migration, and a
  `db/src/domain/` folder holding only shared helpers (`now()`, `newId()`). Frontend: `lib/db.ts`
  (singleton `openDb(process.env.DB_PATH)`), `lib/api/with-db.ts` (`withDb(handler)` → `{ db }`),
  `mapDbError` beside `mapSupabaseError`. Auth removal: delete `app/login`, `components/auth`,
  `middleware.ts`, `lib/supabase/middleware.ts`, `lib/auth/actions.ts`, `e2e/auth.setup.ts`; `requireUser`
  and the still-present `withSession` return a fixed local user; the mock's GoTrue half goes. E2E
  bridge: `playwright.config.ts` passes `DB_PATH` to the Next server; the mock's `/__mock__/reset`
  and `/__mock__/seed` learn a table ownership list and write ported tables into that file through
  `db/`. Root `npm run dev` becomes `migrate && next dev`. `.env.example` gains `DB_PATH`.
- **Out of scope:** porting any route or any domain function.
- **Done when:** `openTestDb()` migrates in under a second; schema tests assert every kept table and
  column exists; one trivial route (`GET /api/health`, new) runs on `withDb`; `check` green with the
  bridge carrying zero tables.

#### 2.2 Port `items` and `folders` (tasks core)

- **Depends:** 2.1.
- **Build:** `db/src/domain/items.ts` and `folders.ts`: `getSubtree`, `completeSubtree`,
  `completeAndSpawn` (recurrence), `assertSubtaskShape`, `inheritDispatchedAt`,
  `returnItemsToInbox` (folder delete), `clearDueTimeWithDate`, `assertTaskOnlyFields`,
  `assertDispatchedNeedsFolder`, and the `task_items` read. Port `app/api/items/**` (1,874 lines of
  routes), `app/api/tasks/**`, `app/api/folders/**` and `lib/data/{items,folders}.ts` to `withDb`;
  the ingest-key path on `POST /api/items` keeps its key check and uses `db`. Re-platform their
  tests onto `openTestDb()`; port the `items`/`folders` invariants out of
  `database/src/assertions.ts`. Add `items` and `folders` to the e2e bridge's ownership list.
- **Done when:** the inbox, folders, subtasks, completion, recurrence, due-date and dispatch e2e specs
  pass with those tables on SQLite; coverage guard satisfied; `check` green.

#### 2.3 Port `weekly_plans`, `habits`, `habit_entries`

- **Depends:** 2.2.
- **Build:** `createWeeklyPlanItems` and the habit domain into `db/src/domain`; port
  `app/api/weekly-plans/**`, `app/api/habits/**`, `lib/data/{weekly-plans,habits}.ts`; re-platform
  tests; port assertions; extend the bridge.
- **Done when:** plan, today, priority and habits e2e specs pass on SQLite; coverage guard; `check` green.

#### 2.4 Port `projects`, `epics`, `code_items` (code module, current shape)

- **Depends:** 2.3.
- **Build:** `enterCodeModule`, `createCodeStory`, `swapCodePriority`, `moveCodePriority`,
  `moveCodePriorityInProject`, `respaceCodePriorities`, `topOfProjectPriority`, `stampDoneAt`,
  `stampPriorityRev`, `assertIntendedEpicProject`, the `v_code_stories` read, and minimal ports of
  `nextCodeRef`, `createEpic`, `convertToCodeEpic` (a counter increment and two inserts; Phase 4
  deletes them, so keep them tiny). Port `app/api/code/**`, `app/api/epics/**`, `app/api/projects/**`,
  `lib/data/code.ts`; re-platform tests; port assertions; extend the bridge. The GitHub dashboard
  routes (`pr-ratio`, `loc-velocity`) move to `withDb` but keep their 501-when-unconfigured behaviour.
- **Done when:** all `code-*`, `inbox-epic`, `inbox-project-suggest` e2e specs pass on SQLite;
  coverage guard; `check` green.

#### 2.5 Decommission Supabase and the Postgres toolchain

- **Depends:** 2.4.
- **Build:** delete `@supabase/*` dependencies, `lib/supabase/*`, `lib/api/auth.ts`'s session paths,
  `lib/api/supabase-route-double.ts`, `mapSupabaseError`, `lib/database.types.ts`, the
  `Database[...]` aliases in `lib/types.ts` (replace with `db/` inferred types), `jest.setup.ts`'s
  Supabase stubs, `.storybook/supabase-ssr-mock.ts`, `frontend/scripts/mock-supabase.mjs` and every
  `/__mock__` reference. The e2e harness becomes a 100-line test-control server over `db/`
  (`reset` = delete all rows, `seed` = insert `SeedState`). Delete the `database/` workspace,
  `tools/migration-lint`, `.github/workflows/{migrate,migration-numbers}.yml`, the `supabase` and
  `migration-lint` skills and the `psql` references in others. Write `FORK.md` with the upstream base
  sha. `README.md` gets its "Run locally" section: Node 24, `npm ci`, `npm run dev`.
- **Done when:** `grep -ri supabase` finds only `FORK.md` and `docs/specs/archive`; fresh clone →
  `npm ci` → `npm run dev` opens the app on capture with data persisting across restarts; `check`
  green; **this is the first demo against the running app**.

#### 2.6 Startup backup and restore (interim, pre-runner)

- **Depends:** 2.5. Decision D3.
- **Build:** `db/src/{backup,restore,verify-backup}.ts` (`VACUUM INTO`, `integrity_check`,
  retention pruning with an injected clock and fs), `npm run backup|restore|backup:verify -w db`, the
  startup snapshot from `instrumentation.ts`, `check:slow` runs `backup:verify`. The interval schedule
  waits for the runner (3.2).
- **Done when:** a snapshot appears on each dev-server start; restore of a snapshot taken after a
  capture brings the capture back (demo); pruning unit-tested.

### Phase 3 — Runner (2 chunks)

#### 3.1 Runner skeleton and the change cursor (replaces realtime)

- **Depends:** 2.5. Decision D7, D9.
- **Build:** `runner/` workspace (tsconfig strictest, jest, eslint like `daemon/` had) with env
  loading from `frontend/.env.local`, `openDb(DB_PATH)`, a tick loop with per-job intervals writing
  `runner_health`, graceful shutdown. Root `npm run dev` adds it under `concurrently`. Migration: add
  `updated_at` to `items`, `folders`, `epics` (and `runner_health`); the domain layer stamps it on
  every write. Frontend: `GET /api/changes?since=` returning changed ids by table; `tasks-store` and
  `code-store` drop their channels and `lib/supabase/realtime.ts` residue, and poll the cursor every
  3 s while `document.visibilityState === 'visible'`. A runner status chip in the shell reads
  `runner_health`.
- **Done when:** a row updated through `sqlite3` or a script shows up in the open tab within one
  poll; the runner survives a dev-server restart; unit tests for the scheduler and the cursor route.

#### 3.2 Backups on a schedule

- **Depends:** 2.6, 3.1.
- **Build:** move the schedule into the runner: interval from `settings` (default 4 h), on startup,
  on `SIGTERM`; backup directory from `settings`; the status chip shows last backup time and a
  warning when none is younger than 2 intervals.
- **Done when:** fake-clock tests of the schedule; demo shows the interval snapshot landing in a
  configured folder.

### Phase 4 — Code module overhaul (8 chunks)

#### 4.1 Domain migration: Jira keys, GitLab projects, agent sessions

- **Depends:** 2.5. Decision D6. Can start before Phase 3.
- **Build:** the §4.2 schema change as a Drizzle migration; delete `nextCodeRef`, `createEpic`,
  `convertToCodeEpic`; update `lib/api/schemas.ts`, `lib/data/code.ts`, the code store and
  `api-client.ts` for the renamed columns; the gate dialog asks for a Jira key (validated
  `^[A-Z][A-Z0-9_]+-\d+$`) instead of allocating one; the new-project dialog takes GitLab path, Jira
  key, local clone path, default branch; remove the epic-creation dialog; `story-ref` atom renders the
  Jira key and links to `JIRA_BASE_URL/browse/<key>`. Delete `lib/code/links.ts`, `launch.ts`,
  `github.ts`, `lib/github/*`, `project-prefix.ts` and their tests; leave the launch buttons rendering
  disabled with a "coming in 4.5" tooltip so the board stays usable.
- **Done when:** a project and a story with a hand-entered key appear on the board; priority
  drag-and-drop still works; `check` green.

#### 4.2 Jira client and read sync

- **Depends:** 3.1, 4.1. Confirm Cloud vs Data Center and the one-repo-per-key question first.
- **Build:** `runner/src/jira/` with a typed client (your flavour), a sync job: per project run the
  JQL (default `project = <KEY> AND assignee = currentUser() AND statusCategory != Done`, overridable in
  `projects.jql_override`), upsert epics from parents and stories from issues (a new
  `importCodeStory` domain function; refresh `jira_*` columns on existing rows; never touch
  `factory_state` after import), cursor on `updated >= last_synced_at`. Description stored as rendered
  plain text (Cloud: extract text from ADF; DC: strip wiki markup) with the raw kept in
  `jira_description_raw`. Settings UI: a Jira section on the project header showing last sync, count,
  errors, and a "Sync now" button that flips a `settings.sync_requested` flag the runner honours on
  its next tick.
- **Done when:** with a token in `.env.local` and a sandbox Jira project, issues land on the board
  in the right epics within one tick; tests use recorded JSON fixtures (scrubbed of anything work-specific).

#### 4.3 GitLab client, MR poll and state transitions

- **Depends:** 4.2. Decision D8.
- **Build:** `runner/src/gitlab/` typed client (API v4, `PRIVATE-TOKEN`); a poll job per project
  listing MRs `updated_after` `projects.mr_cursor`, parsing the ```` ```alfred ```` block with the parked
  `frontmatter.ts`, mapping GitLab state to `(action, merged)` and applying the parked `transitions.ts`
  (unchanged logic, including spike and bug phases) through `db/`, writing MR URLs, snapshotting the
  spec through the Repository Files API (ported `github.ts`'s fetchSpec). Idempotent on re-poll
  (compare `updated_at`). Board cards show the MR chip (`review-pr-chip` atom renamed).
- **Done when:** the full transition table has unit coverage against GitLab-shaped fixtures; an MR
  opened and merged in a sandbox GitLab project moves a story `in_refinement → ready_for_dev` with the
  spec rendered in the detail modal.

#### 4.4 Copilot session executor

- **Depends:** 3.1, 4.1. Confirm the tool allowlist policy.
- **Build:** `runner/src/sessions/`: claim the oldest `queued` row (one running at a time,
  configurable), `git -C <local_repo_path> fetch` then `git worktree add
  ./.local/worktrees/<key>-<phase>-<id> -b <branch> origin/<default_branch>`, write `prompt.md`, spawn
  `copilot` with the D7 flags and the allowlist from `settings`, pipe output to
  `./.local/sessions/<id>.log`, record `pid`, `started_at`, exit code, `finished_at`, `status`; timeout
  from `settings` (default 90 min); cancel by killing the process group when a row flips to
  `cancelled`; worktree pruning for finished sessions after N days. Branch naming
  `<KEY>-<phase>-<slug>` so GitLab's Jira integration links it. Frontend: `POST /api/code/sessions`
  (enqueue), `PATCH …/cancel`, `GET …/:id/log?offset=` (tail). No UI yet beyond routes.
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
  (ground in the repo; the clarification gate becomes "stop and write questions into the MR
  description" since no human is in the loop mid-run; verbatim self-check). `docs/code-module/repo-setup/`
  becomes a kit a work repo copies in: `AGENTS.md`/`.github/copilot-instructions.md` template, the
  refinement/implement/spike/bug skills under `.claude/skills/` (Copilot CLI reads that folder; verify
  `.github/skills` too and pick one), the optional `.gitlab-ci.yml` include that fails an MR missing
  the block. Remove the `alfred-frontmatter.yml` GitHub Action.
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
- **Build:** rewrite `README.md` (prerequisites: Node 24, tokens; run; backups; restore), `CLAUDE.md`
  (monorepo at a glance: `frontend`, `db`, `runner`, `tools/*`; remove Vercel/Supabase/Workers rules
  and the generated-types rule; add the runner, the `db/` domain-layer rule "invariants live in
  `db/src/domain`, never in a route", and the "never work-specific" rule), `docs/specs/product/SPEC.md`
  becomes the fork's product spec with this document folded in, archive the upstream code-module spec.
  Prune and add skills: drop `supabase`, `cloudflare-workers`, `anthropic-api`, `migration-lint`,
  `mac-daemon`, `llm-evaluation`; add `sqlite-drizzle` (driver choice, WAL, type mapping, migration
  workflow, `openTestDb` testing pattern), `runner`, `gitlab-api`, `jira-api`, `copilot-cli`;
  `nextjs` loses Vercel; `gh-cli` becomes `glab` if that CLI is used at work. Run `skill-lint`.
- **Done when:** a fresh reader can set up and run the fork from the README alone; `lint:skills` green.

#### 5.2 Dead tooling and CI

- **Depends:** 5.1.
- **Build:** delete `.github/workflows/{backup}.yml`, `scripts/cloud-setup.sh`,
  `docs/cloud-environment.md`, `frontend/scripts/snapshot-docker.mjs` **if** Docker is unavailable at
  work (then snapshots run natively with a Linux-only CI baseline, or the snapshot gate moves to CI
  only). `ci.yml` runs `check` on the personal GitHub fork.
- **Done when:** CI green on the fork; no reference to Vercel, Supabase, Cloudflare, Anthropic or
  GitHub Actions deploys remains outside `docs/specs/archive` and `FORK.md`.

#### 5.3 Inbox classification via Copilot (optional)

- **Depends:** 3.1.
- **Build:** a runner job that batches `unclassified` items and asks `copilot -p … -s` for JSON
  (`{item_type, folder_hint, project_hint}`) with a strict schema check and the same
  claim/correction semantics the old classifier had, re-adding the live-classify UI behind a setting.
- **Done when:** fixtures of model output drive unit tests; the job is off by default.

---

## 7. Open questions for you

Only the ones that change what gets built:

1. **D6:** Jira **Cloud or Data Center**? One Jira project per repo, or many repos per project?
   (Blocks 4.2.)
2. **D7:** Is unattended `copilot -p` with `--allow-all-tools` acceptable under your employer's
   policy, or must the allowlist be narrow (`--allow-tool shell(git)` and so on)? (Blocks 4.4.)
3. **D4:** Agree to cut wiki with the seam described? If not, the replacement is a "notes" module over
   a local markdown folder and is its own phase, not a port of the current one.
4. **D10:** Name of the fork repo (private), so the fenced block tag, the database file and the
   `.local/` directory can be named for it instead of `alfred`.
5. **5.2:** Is Docker available at work? It decides whether the Storybook snapshot gate keeps its
   pinned image or moves to CI only.

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
- **SQLite:** `VACUUM INTO 'file'` writes a consistent snapshot of a live WAL database;
  `PRAGMA integrity_check`; WAL mode supports one writer and many readers across processes;
  recursive CTEs, JSON1, views, triggers, generated columns and `RETURNING` are all available.
- **Node 24:** `node:sqlite` is built in (the daemon already uses `DatabaseSync`); check its
  stability flag and Drizzle driver support in 2.1 before choosing it over `better-sqlite3`.

### 8.2 Session count and order at a glance

| Phase | Chunks | Can parallelise |
|---|---|---|
| 1 Strip | 1.1 → 1.4 | no (shared shell files) |
| 2 SQLite | 2.1 → 2.6 | no (each extends the same bridge and `db/` schema) |
| 3 Runner | 3.1, 3.2 | 3.1 alongside 4.1 |
| 4 Code | 4.1 → 4.8 | 4.2 ∥ 4.4 after 4.1 and 3.1; 4.7 ∥ 4.5 |
| 5 Polish | 5.1 → 5.3 | 5.3 any time after 3.1 |

23 chunks, of which 4.8 and 5.3 are optional. The first useful milestone (an offline tasks app with a
startup backup) is the end of Phase 2: eleven sessions, of which four are deletions. That is about
five sessions later than the Postgres path would have reached it, which is the price D1 chose to pay.
