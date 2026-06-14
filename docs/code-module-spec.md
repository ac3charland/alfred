# Software Factory — `code` Module Specification

> **Status:** Implementation-ready spec. Hand to a coding agent (or a lead + sub-agents).
> **Audience:** Coding agents working in `alfred`, and the project owner.
> **Scope of this document:** Build the **Software Factory** (the `code` item type) end to
> end — inbox classification → Project/Epic/Story model → a Kanban "Code" view → human-launched
> Claude Code Web sessions (refine, then implement) → a GitHub-webhook Worker that turns PR
> events into deterministic ticket-state transitions. This is the concrete build-out of
> [`SPEC.md`](SPEC.md) §13.3 (Software Factory) and the type-specific edges of §3.
>
> **In scope:** the human-driven "open Claude Code in a new tab" lane (the doc below calls it
> **Lane 2**). **Out of scope (reserved, not built):** the local-LLM-implements / Claude-reviews
> lane (**Lane 1**). The schema and state machine are designed so Lane 1 slots in later behind a
> per-story `lane` flag (§4.3, §18) — but no Lane-1 dispatch, review loop, or local-model wiring
> is built now.
>
> **Source of decisions:** the pre-spec working notes (`alfredsoftwarefactorydirection.md`) plus
> the owner's resolutions captured inline. Where this spec and those notes disagree, **this spec
> wins** (it reflects the codebase as it actually is).

---

## 1. Why this is a custom module (constraints that shaped it)

Two external constraints did the design work. Internalize them; several "obvious" designs are
dead on arrival.

1. **No legal automated Claude on a subscription.** Anthropic's Consumer ToS bars using
   Free/Pro/Max OAuth tokens in any other product, and bars automated/non-human access to
   claude.ai / Claude Code Web (no Playwright/Selenium driving a logged-in tab). The only
   sanctioned *automated* Claude execution is via an **API key / Agent SDK credits, at API
   rates**. The only way to spend *subscription* allowance is a **human driving a first-party
   surface by hand**. → This module leans on a **human click** that opens a Claude Code Web tab
   with context pre-filled. The link **prefills but never auto-executes**; the human reviews and
   hits enter. That is what keeps us ToS-clean.
2. **Linear rejected.** Cost (no subscription subsidy exists) *and* fit (Linear treats issues as
   flat; our work moves through a multi-phase **refine → implement** lifecycle driven by PR
   events). → A genuine custom module in alfred, not an adapter to a SaaS board.

**Dead ends — do not re-propose:** subscription-token harnesses; browser automation of claude.ai;
embedding claude.ai in an `<iframe>` (blocked by `X-Frame-Options` + auth); an Anthropic API for
live Claude Code Web session status (does not exist — their webhooks are for the *Managed Agents*
product, a different thing); a browser extension relaying tab state (deferred, not built).

The keystone that makes all of this work without any Anthropic session API: **every phase ends in a
GitHub PR**, and a **signature-verified Worker** turns PR webhooks into state transitions (§12–13).

---

## 2. Where this sits in the current codebase

What already exists (verified against the repo) and what this module adds:

| Concern | Today | This module adds |
|---|---|---|
| `items` table | generic core + task fields; `item_type` enum already includes `'code'` | sidecar `code_items` + `projects` + `epics` tables (§4) |
| Classification | none — capture always writes `item_type='unclassified'`; everything renders as a task | inbox classification UI + type badges (§7) |
| Type-specific fields | due dates + subtasks are usable on **any** item (no classification gate) | gate them behind `task` classification — only `task` items get due dates + subtasks; `notes` stay generic; code stories get Project/Epic/Ref/state (§4, §7, §7.3) |
| App shell | `(tasks)` route group; sidebar with `alfred` wordmark + `FolderNav` (Inbox/Folders/Completed) | a **Tasks ⇄ Code** view switcher; a `(code)` route group; Inbox button removed (§6) |
| `workers/` | bare skeleton (`fetch` returns `alfred workers ok`) | the GitHub PR webhook Worker (§13) |
| Data flow | `getAllItems()`+`getFolders()` seed client stores; optimistic mutate → `/api/*` → Supabase | `CodeProvider` store + `/api/projects`, `/api/epics`, `/api/code` routes (§14) |

Key files to know going in:
`database/migrations/0001_initial_schema.sql` (schema + RPC style),
`frontend/app/(tasks)/layout.tsx` (shell), `frontend/components/tasks/folder-nav.tsx`,
`frontend/components/tasks/task-row.tsx` (row + dropdown menu),
`frontend/components/tasks/alfred-link.tsx` (wordmark → `/` capture),
`frontend/lib/stores/tasks-store.tsx` + `folders-store.tsx` (optimistic store pattern),
`frontend/lib/api-client.ts`, `workers/src/index.ts`, `workers/wrangler.toml`.

---

## 3. Domain model & vocabulary

- **Project** — *= a GitHub repository.* Top-level container. Has a human-picked **key** (**exactly 3
  chars**, uppercase, e.g. `ALF`, `RLP`) used as the prefix for all refs in the project, and the repo
  coordinates used to build Claude Code URLs and match webhooks.
- **Epic** — a grouping within a project (e.g. "Communication Firewall"). No refine→implement
  lifecycle of its own, but it **can carry `notes`** and be **archived once done** (archived epics
  drop off the active board, §9.2). Gets a human-visible **ref** like a story.
- **Story** — the unit of work that runs the **refine → implement** lifecycle. *A story is an
  `items` row* with `item_type='code'` plus a `code_items` sidecar row. This is the "ticket."
- **Ref** — the human-visible id, `KEY-N` (e.g. `ALF-42`). **Epics and stories share one
  per-project counter**, so every ref in a project is unique whether it names an epic or a story.
  Refs appear in the UI, in branch names, and in PR frontmatter (§12).
- **Factory state** — where a story sits in the lifecycle (§5). Code stories do **not** use
  `items.status` (`active`/`completed`) at all — that field is **task-only**. A code story is
  "complete" only when its implementation PR merges and `factory_state` becomes `done`; its
  `items.status` stays at the default `active` and is ignored.
- **Lane** — how much supervision a story needs. **Lane 2** (human-launched Claude Code Web) is the
  only lane built now; **Lane 1** (local model implements, Claude reviews) is reserved (§18).

The board's shape (owner's decision): the **Code view** lists **projects** in the left nav; the main
pane shows the selected project's **epics**, each **collapsible**, and each epic owns its **own row
of swimlanes** (the factory states), with **stories as cards** in those swimlanes.

---

## 4. Data model & migration

New migration: `database/migrations/0002_software_factory.sql`. Follow the conventions in `0001`
(enums up top; `comment on` for non-obvious columns; RLS `authenticated full access`; explicit
GRANTs to `anon, authenticated, service_role`; `SECURITY INVOKER` RPCs for anything PostgREST can't
express). After writing the migration, **regenerate** `frontend/lib/database.types.ts`
(`supabase gen types`) and commit the raw output — never hand-edit it.

> **Sandbox limitation (read before implementing).** Steps that need live credentials — running
> `supabase gen types` and `supabase db push` against the project, setting `wrangler` secrets, and
> deploying the Worker — **cannot be done by an agent in a CI/web sandbox**, which has no access to
> the gitignored `frontend/.env.local` (Supabase keys) or the Worker secrets. A sandbox agent should
> write the migration/code and leave these credentialed steps as an explicit checklist to run at the
> end in a **local, high-touch session** with `.env.local` present. The same applies to the per-repo
> GitHub webhook + token setup (§13.4).

### 4.1 Enums

```sql
create type code_factory_state as enum (
  'needs_refinement',  -- entered the factory; refinement not started
  'in_refinement',     -- user launched the refinement session
  'ready_for_dev',     -- refinement PR merged; spec exists
  'in_development',    -- user launched the implementation session
  'ready_for_review',  -- implementation PR open
  'done',              -- implementation PR merged
  'blocked',           -- escape hatch (checks failing / manual)
  'abandoned'          -- escape hatch (won't ship / manual)
);

create type code_lane as enum ('human', 'local');  -- only 'human' (Lane 2) used now
```

### 4.2 Tables

```sql
-- A project = a GitHub repo. `key` prefixes every ref; `ref_seq` is the shared
-- per-project counter for epics AND stories. Keep `key` immutable after creation.
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  key         text not null unique check (key ~ '^[A-Z][A-Z0-9]{2}$'), -- exactly 3 chars
  repo_owner  text not null,        -- e.g. 'ac3charland'
  repo_name   text not null,        -- e.g. 'alfred'
  github_url  text,                 -- convenience; owner/name is the source of truth
  ref_seq     int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (repo_owner, repo_name)
);

-- Epics: organizing buckets. Ref drawn from the project counter.
create table epics (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  name        text not null,
  notes       text,                 -- optional epic-level notes
  ref_number  int  not null,
  ref         text not null unique, -- denormalized KEY-N for display/lookup
  archived_at timestamptz,          -- set when the epic is archived (done); null = active
  created_at  timestamptz not null default now()
);

-- Code stories: 1:1 sidecar on `items` (item_type='code'). Presence of a row here
-- means "this item is in the factory" (and so is hidden from the Tasks/Inbox views).
create table code_items (
  item_id              uuid primary key references items (id) on delete cascade,
  project_id           uuid not null references projects (id) on delete restrict,
  epic_id              uuid not null references epics (id) on delete restrict,
  ref_number           int  not null,
  ref                  text not null unique,
  factory_state        code_factory_state not null default 'needs_refinement',
  lane                 code_lane not null default 'human',
  spec_path            text,        -- declared by the refinement PR (§12); never inferred
  spec_sha             text,        -- blob sha of the snapshotted spec
  spec_markdown        text,        -- Option B snapshot rendered in the detail modal (§10)
  refinement_pr_url    text,
  implementation_pr_url text,
  blocked_reason       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index epics_project_id_idx      on epics (project_id);
create index code_items_project_id_idx on code_items (project_id);
create index code_items_epic_id_idx    on code_items (epic_id);
create index code_items_state_idx      on code_items (factory_state);
```

> **Why a sidecar, not columns on `items`:** the factory carries ~12 type-specific fields; bolting
> them onto `items` bloats the hot tasks query for no benefit. The 1:1 `code_items` row also gives
> us a clean membership test ("is this item in the factory?") used by the read paths (§4.5).

### 4.3 Ref allocation & atomic RPCs

Refs must be **server-allocated** (never client-minted) so two creations can't collide. Both epic
creation and story entry draw from `projects.ref_seq` in a single statement. Expose atomic RPCs in
the migration (mirroring `get_subtree`/`complete_subtree`):

```sql
-- Allocate the next ref number for a project (atomic increment).
create or replace function next_code_ref(p_project uuid) returns int
language sql security invoker as $$
  update projects set ref_seq = ref_seq + 1 where id = p_project returning ref_seq;
$$;

-- Create an epic with an allocated ref; returns the row.
create or replace function create_epic(p_project uuid, p_name text)
returns epics language plpgsql security invoker as $$
declare n int; k text; row epics;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  insert into epics (project_id, name, ref_number, ref)
  values (p_project, p_name, n, k || '-' || n) returning * into row;
  return row;
end; $$;

-- Move an item into the factory: flip item_type, allocate ref, create the sidecar.
-- Used by both "Send to Code module" (inbox) and "Convert to Code Story" (a task).
create or replace function enter_code_module(p_item uuid, p_project uuid, p_epic uuid)
returns code_items language plpgsql security invoker as $$
declare n int; k text; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  update items set item_type = 'code' where id = p_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref)
  values (p_item, p_project, p_epic, n, k || '-' || n) returning * into row;
  return row;
end; $$;
```

> Refs are unique per project **by construction** (shared counter); the `unique` index on
> `code_items.ref` / `epics.ref` is belt-and-suspenders. `key` is immutable so refs never go stale.

### 4.4 RLS & grants

Single-user, identical to `0001`: enable RLS on all three tables; `create policy "authenticated full
access" … using (true) with check (true)`; `grant select, insert, update, delete` on the tables and
`grant execute` on the RPCs to `anon, authenticated, service_role`. The **Worker** writes via the
**service_role/secret key** (bypasses RLS) for the trusted webhook ingress (§13).

### 4.5 Read paths (membership split)

The dividing line is **"does the item have a `code_items` row?"**

- **Tasks / Inbox views** must show items **not** in the factory — including
  code-*classified-but-not-yet-sent* items (`item_type='code'`, no `code_items` row). Add a view the
  tasks data layer reads instead of `items` directly:
  ```sql
  create view task_items as
    select i.* from items i
    where not exists (select 1 from code_items c where c.item_id = i.id);
  ```
  Point `frontend/lib/data/items.ts::getAllItems()` (and the subtree RPC's effective inputs) at this
  view. *Acceptable alternative* (house "fetch-all then filter client-side" pattern): also fetch the
  set of factory item-ids and filter them out in the tasks store. Prefer the view for correctness.
- **Code view** reads `code_items` joined to `items`, `projects`, `epics` (a `v_code_stories` view or
  a PostgREST embed). Volume is small (single user) — fetch all for the selected project and filter
  client-side.

---

## 5. Lifecycle & state machine

### 5.1 States (happy path)

`needs_refinement → in_refinement → ready_for_dev → in_development → ready_for_review → done`

Plus two escape states reachable manually (and, where noted, automatically): `blocked`, `abandoned`.

### 5.2 Transitions

| From | Trigger | To | Mechanism |
|---|---|---|---|
| (inbox, `item_type='code'`) | user assigns Project + Epic, confirms gate | `needs_refinement` | app: `enter_code_module` RPC (§4.3, §8) |
| (a task) | user picks **Convert to Code Story**, assigns Project + Epic | `needs_refinement` | same RPC; also flips `item_type` |
| `needs_refinement` | user clicks **refinement** link | `in_refinement` | client handler: await Supabase write → open tab (§11.3) |
| `in_refinement` | refinement PR **opened** | *(no state change)* | webhook → Worker records `refinement_pr_url` (§13) |
| `in_refinement` | refinement PR **merged** | `ready_for_dev` | webhook → Worker; snapshot spec (`spec_path`,`spec_sha`,`spec_markdown`) |
| `in_refinement` | refinement PR **closed, unmerged** | `needs_refinement` | webhook → Worker (revert so user can retry; `abandoned` is manual) |
| `ready_for_dev` | user clicks **implementation** link | `in_development` | client handler: await write → open tab (§11.3) |
| `in_development` | implementation PR **opened** | `ready_for_review` | webhook → Worker |
| `ready_for_review` | implementation PR **merged** | `done` | webhook → Worker |
| `in_development`/`ready_for_review` | implementation PR **closed, unmerged** | `ready_for_dev` | webhook → Worker (revert) |
| any | manual action in detail modal | any (notably `blocked`, `abandoned`, or a corrective hop) | app: PATCH `/api/code/:ref` (§10, §13 fallback) |

**Manual fallback (required).** Spikes, research, and abandoned items have no PR signal. The detail
modal (§10) must offer manual state controls — at minimum *Block*, *Abandon*, and *Advance/Revert
one step* — so a human can move any story without a PR.

### 5.3 No separate spec-review state

There is **no `spec_review` state**. A refinement PR *opening* is a **no-op** for the state machine
(the Worker just records `refinement_pr_url`); any back-and-forth happens through **PR comments**
(Claude Code Web already responds to review comments). The story stays in `in_refinement` until the
refinement PR **merges**, which moves it **straight to `ready_for_dev`**.

---

## 6. App shell: the Tasks ⇄ Code view switcher

Owner's decision, implemented as a small restructure of the shell (`frontend/app/(tasks)/layout.tsx`
and a new `frontend/app/(code)/layout.tsx`, sharing one sidebar/header shell):

1. **View switcher.** In the top-left header square (where the `alfred` wordmark lives), add a
   two-button segmented switcher **`Tasks` | `Code`** (à la the Claude desktop app). It toggles which
   module is active:
   - **Tasks** → left nav = **Folders** (the existing `FolderNav`, minus the Inbox button); main pane
     = tasks/capture (unchanged).
   - **Code** → left nav = **Projects** (`ProjectNav`, §9.1); main pane = the selected project's board
     (§9.2).
   Implement as links/route navigation (Tasks → `/`, Code → `/code`) so each module keeps the
   route-group encapsulation `SPEC.md` calls for; render the correct nav from the active route. Use
   the existing `ViewLink` for client-side nav and active styling.
2. **Remove the Inbox button** from `FolderNav`. The **`alfred` wordmark** remains the way into the
   inbox/capture screen — it already navigates to `/` and fires `ALFRED_CAPTURE_FOCUS_EVENT`
   (`alfred-link.tsx`); the inbox stays **closed by default** (landing shows the capture box; the
   inbox list opens via the existing `?view=inbox`). No behavior change to the wordmark itself.
3. **Mobile:** the switcher joins the mobile nav (`mobile-nav.tsx`) alongside the hamburger.

Keep the dark, dense aesthetic and the existing tokens (`bg-surface`, `border-border`,
`text-accent-teal`, the serif wordmark). New surfaces use shadcn/Radix primitives already in the repo.

---

## 7. Inbox classification & type badges

Today every capture is `unclassified` and renders as a task with no type affordance. Add:

### 7.1 Classification control

In the item row dropdown menu (`task-row.tsx`, the existing Radix `DropdownMenu`), add a **`Classify
as ▸`** submenu with **`Task`** and **`Code`** (Knowledge is future — leave room, don't build it):

- **Classify as Task** → `updateItem(id, { item_type: 'task' })`. Classifying as `task` is what
  **unlocks** due-date and subtask editing (plus the Task badge); an `unclassified` item exposes
  neither (§7.3).
- **Classify as Code** → `updateItem(id, { item_type: 'code' })`. The item **stays in the inbox** (no
  `code_items` row yet) and now shows a **Code** badge plus a **`Send to Code module…`** action
  (enabled only once type is `code`) that opens the gate (§8).
- **Convert to Code Story…** (shown on items that are currently tasks/unclassified — this is the
  path for the existing "Software" folder tasks) → opens the gate (§8) directly; on confirm it both
  flips `item_type='code'` and creates the factory row in one step (the `enter_code_module` RPC).

### 7.2 Type badges

Add a small `TypeBadge` atom (`frontend/components/tasks/type-badge.tsx`, Storybook story +
visual-snapshot per the `storybook` skill) shown on inbox/task rows once `item_type !==
'unclassified'`: **`Task`** and **`Code`** (muted chip, consistent with the due-date / count chips
already in `task-row.tsx`). Unclassified items show no badge. Knowledge is reserved.

### 7.3 Type-specific fields (clarification)

The direction notes mention "type-specific fields (due dates + subitems for tasks, epics + projects
for code)." Make them genuinely type-gated:

- **Due dates and subtasks are `task`-only — not generic.** An `unclassified` (or `code`) item must
  **not** expose a due-date or add-subtask affordance; the user classifies it as a **`task`** first,
  and that is what unlocks them. *This is a behavior change from today,* where the UI lets any item
  set a due date or add subtasks. The schema already treats `due_date`/`parent_id` as task-lifecycle
  fields (see the `0001` migration comment), so this only tightens the UI: gate the row's due-date
  and add-subtask controls on `item_type === 'task'`. Existing `unclassified` rows that already carry
  a due date or children should be surfaced for — or auto-promoted to — `task` classification.
- **`notes` stay generic.** They are part of the base item (`SPEC.md` §3.2) and remain available on
  any item regardless of type.
- **Code** items surface **Project / Epic / Ref / state**, which live on the **board and detail
  modal** (§9–10), assigned at the gate (§8), *not* as inline inbox editors. An inbox code item that
  hasn't been sent shows only its Code badge and the **Send to Code module…** affordance.

---

## 8. The gate: Send to Code module / Convert to Code Story

One shared flow (a Radix `Dialog`), entered from either **Send to Code module…** (an
already-`code` inbox item) or **Convert to Code Story…** (a task). Both require **Project + Epic,
no defaults, both blank until chosen** — the confirm button is disabled until both are set.

### 8.1 Project selector

A combobox of existing projects **plus `+ New project…`**. Choosing `+ New project…` opens a nested
dialog with three fields:

- **Name** (free text, e.g. "Alfred").
- **GitHub link** (e.g. `https://github.com/ac3charland/alfred`) — parse to `repo_owner` / `repo_name`
  on submit; store the URL too.
- **Ticket key** (**exactly 3 chars**; uppercase; validated unique against existing keys; the regex in §4.2).
  Show a live preview ("Refs will look like `ALF-12`").

On submit: **optimistically** insert the project (temp id) and reconcile with the server row (house
optimistic-store pattern — see the `data-flow` skill); the combobox then shows the real project name.

### 8.2 Epic selector

Filtered to the chosen project: existing epics **plus `+ New epic…`**. `+ New epic…` opens a small
dialog with just an **Epic name**; on submit it calls `create_epic` (allocates the shared ref),
optimistic-insert + reconcile, then selects the new epic (now showing its real name/ref).

### 8.3 Confirm

On confirm, call `enter_code_module(item_id, project_id, epic_id)` (§4.3). Result: `item_type='code'`,
a `code_items` row at `needs_refinement` with an allocated ref, the item **leaves the Tasks/Inbox
views and appears on the Code board** under its project → epic → *Needs Refinement* swimlane. Toast
the new ref ("Created ALF-42"). All writes are optimistic with reconcile/rollback.

---

## 9. The Code view (board)

New route group `frontend/app/(code)/` with its own layout seeding a `CodeProvider` (projects,
epics, code stories — §14). `requireUser()` gates it exactly like the tasks layout.

### 9.1 Projects nav (`ProjectNav`)

Left sidebar lists projects (active selection highlighted, like `FolderNav`'s folder list). A `+`
opens the same New-project dialog as §8.1. Selecting a project routes to `/code/[projectId]`.

### 9.2 Board pane

For the selected project, render its **epics stacked vertically, each collapsible** (remember
collapsed state per epic). Each expanded epic shows a **row of swimlanes** = the happy-path factory
states (`Needs Refinement`, `In Refinement`, `Ready for Dev`, `In Development`, `Ready for Review`,
`Done`); `blocked`/`abandoned` stories surface via a card treatment + a filter toggle, not a default
column. **Stories are cards** in their state's swimlane, showing **ref**, **title**, and a
**phase-appropriate action** (the "open Claude Code" button, §11) when one applies. Columns are
horizontally scrollable / condensable to fit the dense layout.

- **v1 may ship read-only swimlanes** (state changes come from links + webhook + the detail modal).
  Drag-to-move between swimlanes is **optional polish**; if added, reuse the existing `dnd-kit`
  wiring and persist via the same PATCH the modal uses. (See the `dnd-kit` skill.)
- Clicking a card opens the **detail modal** (§10).
- **Archived epics are hidden by default** (§4.2 `archived_at`); a *Show archived* toggle reveals
  them. Archiving / un-archiving an epic is a **manual** action from the epic header — it does not
  auto-fire when every story is `done`. The epic header also edits the epic's `notes`.

---

## 10. Story detail modal (Jira-style)

A Radix `Dialog` (model it on `cascade-modal.tsx`'s Portal/Overlay/Content structure, sized up).
Opening a story card shows:

- **Header:** `ref` + title (inline-editable title, reusing the row's edit pattern), Project ›
  Epic, current **factory state** chip.
- **Body:** notes; the **rendered spec markdown** for any story past `ready_for_dev` — render
  `code_items.spec_markdown` (the Option B snapshot) with `react-markdown` + `remark-gfm` (add to
  `frontend` deps). A **"View in repo"** link built from `repo_owner/repo_name` + `spec_path` +
  `spec_sha`. If `spec_markdown` is null (snapshot not yet taken) fall back to the repo link.
- **Primary action:** the **phase-appropriate "Open Claude Code" button** (§11) — *refinement* in
  `needs_refinement`, *implementation* in `ready_for_dev`. Disabled/hidden in states where no session
  applies (`in_refinement`, `in_development`, `ready_for_review`, `done`).
- **PR links:** `refinement_pr_url` / `implementation_pr_url` when present.
- **Manual controls (the §5.2 fallback):** *Block*, *Abandon*, and *Advance/Revert one step*, each a
  PATCH to `/api/code/:ref` updating `factory_state` (and `blocked_reason` for Block). These keep the
  board accurate for non-PR work.

> **Spec rendering = Option B (snapshot in Supabase).** The Worker writes `spec_markdown` on
> refinement-merge and refreshes it on later merges/pushes touching `spec_path` (§13). The modal then
> reads pure Supabase — instant, offline-capable, no GitHub token in the read path. Always keep
> `spec_path` + `spec_sha` so the modal can offer "view in repo" and detect drift. Never *infer* the
> path; use the one the PR **declared** (§12).

---

## 11. Claude Code Web links (the human launch)

### 11.1 URL contract

Both links are plain `https://claude.ai/code?...` URLs with a `repo` and a URL-encoded `prompt`
(the Claude Code Web prefill params). They **prefill the composer but do not auto-execute** — the
human reviews and hits enter (keeps us ToS-clean, §1).

```
https://claude.ai/code?repo=<owner>/<name>&prompt=<urlencoded prompt>
```

Build them with pure helpers in `frontend/lib/code/links.ts`:
`buildRefinementUrl(project, story)` and `buildImplementationUrl(project, story)` — derived entirely
from stored data, so links are always fresh and we store no URLs.

> **Verify at implementation time** (flag, don't block): exact Claude Code Web param names
> (`repo`, `prompt`, and any `environment`/branch param) and the **prompt length cap** (desktop's
> `q` truncates ~14k chars; confirm the web limit). Because of the cap, prompts **reference the
> committed spec file**, they do not inline the whole spec. Confirm against the current Claude Code
> web docs (use the `claude-code-guide` agent).

### 11.2 Prompt content

- **Refinement** (active in `needs_refinement`): instruct Claude to **write a spec markdown
  artifact** for this story — *no implementation* — following the project's refinement guide
  (a committed convention, e.g. `.alfred/refinement.md` in the repo, OpenSpec-style), using the
  story's title + notes (short, safe to inline), saving it to `specs/<REF>.md`, and **opening a PR**
  whose description carries the frontmatter block (§12) with `phase: refinement` and
  `spec-path: specs/<REF>.md`. Put the **ref + title first** so the browser tab is scannable.
- **Implementation** (active in `ready_for_dev`, after the spec PR merged): instruct Claude to
  **implement the merged spec** at `code_items.spec_path`, and open a PR whose description carries the
  frontmatter with `phase: implementation`.

### 11.3 Link-click handler (the state transition)

Clicking either link is **not a bare `<a>`** — it is the transition trigger. Single-user on Supabase,
so **await the write behind a brief spinner, then open** (no optimistic/rollback; eliminates the
"looks in-dev but didn't persist" edge). Add an action to the code store:

```ts
async function openClaudeSession(storyRef: string, phase: 'refinement' | 'implementation') {
  // show spinner on the card/modal
  await updateCodeState(storyRef, phase === 'refinement' ? 'in_refinement' : 'in_development');
  window.open(phase === 'refinement' ? refinementUrl : implementationUrl, '_blank');
}
```

**Good-enough live monitoring (Lane 2):** rely on browser notifications + the scannable tab title
(ref + title in the first prompt line). The webhook (§13) is the authoritative status; the tab just
tells the human whether to babysit right now.

---

## 12. PR ↔ ticket contract (the completion keystone)

Every PR (both phases) carries a **machine-readable block** in its description. Keep it dead simple to
regex — a fenced block tagged `alfred`:

````markdown
```alfred
alfred-ticket: ALF-42
phase: refinement
spec-path: specs/ALF-42.md
```
````

- `alfred-ticket` — one ref, or a **comma-separated list** (`ALF-42, ALF-43`) for a PR that closes
  several stories. Parsed as a list, always.
- `phase` — `refinement | implementation`.
- `spec-path` — **refinement PRs only**; declares where the spec lives so Alfred renders from the
  *recorded* path, never an inferred one (§10).

**Enforcing GitHub check.** Each project repo carries a committed reusable workflow
`.github/workflows/alfred-frontmatter.yml` that runs on `pull_request`
(`opened`/`edited`/`synchronize`), parses the block, and **fails the check** when it is missing or
malformed (and when `spec-path` is absent on a refinement PR). Coding agents are already configured
to open PRs and fix failing checks, so they self-correct. *(Alternative: have the Worker set a commit
status via the GitHub API — heavier auth, deferred. The committed Action is self-contained and the v1
choice.)* Provide the workflow as a ready-to-copy artifact in the spec's repo-setup appendix (§19).

---

## 13. The webhook Worker

Build out `workers/src/` (today a skeleton). One Worker, signature-verified, **no LLM** — pure
string-match + DB write. Because both phases end in a PR, this single Worker tracks the whole system.

### 13.1 Endpoint & verification

- Route: `POST /github/webhook` (config the route in `wrangler.toml`; keep the default 200 health
  response for `GET /`).
- **Verify GitHub's HMAC first.** Read the raw body and `X-Hub-Signature-256`; compute
  `HMAC-SHA256(secret, rawBody)` with **Web Crypto** (`crypto.subtle` — no `nodejs_compat` needed for
  this), and compare **constant-time**. Reject `401` on mismatch so status can't be forged. Secret =
  `GITHUB_WEBHOOK_SECRET` (Worker secret).

### 13.2 Handling

1. Handle only `pull_request` events (`X-GitHub-Event: pull_request`). Read `action`,
   `pull_request.merged`, `pull_request.body`, `pull_request.html_url`, `repository.full_name`.
2. **Parse the frontmatter block** (regex over the body): extract `alfred-ticket` (→ list), `phase`,
   `spec-path`. Ignore PRs with no block (not ours).
3. For **each** ref, load the `code_items` row (by `ref`) via Supabase REST using the
   **service_role/secret key** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), and apply the §5.2
   transition by **`(phase, action, merged)`**:
   - refinement + `opened` → no state change; record `refinement_pr_url`.
   - refinement + `closed` & merged → `ready_for_dev`; record `spec_path` + fetch & snapshot the spec
     (§13.3).
   - refinement + `closed` & !merged → `needs_refinement`.
   - implementation + `opened` → `ready_for_review`; record `implementation_pr_url`.
   - implementation + `closed` & merged → `done`.
   - implementation + `closed` & !merged → `ready_for_dev`.
   - *(deferred)* checks-failing → `blocked` — needs `check_suite`/`check_run` events; mark future.
4. Respond `200` quickly; do GitHub fetches in `ctx.waitUntil`.

### 13.3 Spec snapshot (Option B)

On refinement-merge, fetch the spec file via the **GitHub Contents API**
(`GET /repos/{owner}/{name}/contents/{spec_path}?ref=<merge sha>`) using a **fine-grained PAT**
(`GITHUB_TOKEN` secret; read-only Contents on the project repos — single-user, simplest; a GitHub App
is the documented upgrade path). Store the decoded markdown in `code_items.spec_markdown`, plus
`spec_sha`. **Refresh** the snapshot when a later merged PR (or, if you subscribe to them, a `push`
event to the default branch) touches the recorded `spec_path`.

### 13.4 Worker shape, env, deploy

- Typed `Env`: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  (all secrets). Add to `wrangler.toml`; let Wrangler generate
  `worker-configuration.d.ts` (keep it in the ESLint/Prettier ignores — it's generated).
- Prefer **raw `fetch` to Supabase REST** over bundling `@supabase/supabase-js` (smaller Worker; see
  the `cloudflare-workers` skill). Parse frontmatter with a small regex — **no `yaml` dep**.
- Tests (`workers/src/*.test.ts`, jest, the package's `check:fast`): HMAC verify (valid/invalid),
  frontmatter parsing (single ref, list, malformed, missing), the `(phase, action, merged)` →
  state-transition table, and the spec-snapshot fetch (mock `fetch`). This is pure logic — high
  unit-test value; cover every transition row.
- **Setup (one-time, per repo):** add the GitHub webhook (`pull_request` events, the shared
  `GITHUB_WEBHOOK_SECRET`, the Worker URL), copy in the enforcing workflow (§12), and ensure the
  refinement-guide convention file exists. Document in §19.

---

## 14. Data flow & stores (frontend)

Follow the house pattern (`data-flow` skill): server layout fetches → seeds a client store →
components read via hooks and mutate via optimistic actions → `/api/*` → Supabase → reconcile.

- **`CodeProvider`** (`frontend/lib/stores/code-store.tsx`): holds `projects`, `epics`, and code
  `stories` (item + sidecar). Hooks: `useProjects()`, `useProjectBoard(projectId)` (epics +
  stories grouped by epic → state), `useCodeActions()`.
- **Actions (optimistic + reconcile):** `createProject`, `createEpic`, `updateEpic` (notes +
  archive/un-archive), `enterCodeModule` (the gate), `updateCodeState` (manual transitions + the
  link-click write), `convertTaskToCode`.
- **API routes** (Next.js, mirroring `app/api/items`, `app/api/folders`): `app/api/projects`
  (GET/POST), `app/api/epics` (GET/POST, calls `create_epic`), `app/api/epics/[id]` (PATCH notes /
  `archived_at`), `app/api/code` (GET list; POST = the gate via `enter_code_module`),
  `app/api/code/[ref]` (PATCH state). Extend `frontend/lib/api-client.ts` with typed `createProject` /
  `createEpic` / `updateEpic` / `enterCodeModule` / `updateCodeState` (remember: send `null` for
  clears only from the null-aware `lib/` layer, per the existing `moveToInbox` note).
- **Tasks store** unchanged except its source becomes the `task_items` view (§4.5) so factory
  stories disappear from Tasks/Inbox.

---

## 15. Testing & demo docs

Per `CLAUDE.md`: every behavioral change touches **at least one** test (unit / Storybook / e2e), and
each user-facing change gets a **demo doc** once `check` is green. Suggested coverage:

- **Worker (jest):** HMAC, frontmatter parse, the full transition table, snapshot fetch — pure logic,
  test exhaustively.
- **RPCs / migration:** a unit/integration test (or a documented `psql` check) that `create_epic` and
  `enter_code_module` allocate refs from the shared counter without collision, and that `task_items`
  excludes factory items.
- **React (RTL):** classification menu + `TypeBadge`; the gate dialog (required Project+Epic;
  New-project/New-epic sub-dialogs; optimistic create); the detail modal (state chip, spec render,
  manual controls); the link-click handler (awaits write before `window.open` — mock both).
- **Storybook:** `TypeBadge`, a story **card**, a **swimlane**, the detail **modal** — with
  visual-snapshot baselines (the `storybook` skill: capture diff image, then approve).
- **Playwright (e2e):** capture → classify Code → gate (new project + epic) → card appears on the
  board in *Needs Refinement*; convert a task → it leaves Tasks and lands on the board; open the
  detail modal and drive a manual transition. Webhook-driven transitions are exercised in Worker unit
  tests, not e2e.
- **Demo docs** (`docs/demos/<feature>/…`, `npm run demo`): the classification + badge flow; the gate
  (with screenshots); a board screenshot; and a Worker demo that posts a signed sample
  `pull_request` payload and shows the resulting state change.

---

## 16. Implementation plan (for a lead + sub-agents)

Sliceable into milestones with clear seams; later milestones depend on earlier schema/contracts.
Each milestone is independently shippable behind the Code view (which can stay empty until M3).

- **M1 — Schema & contract.** Migration `0002` (tables, enums, RPCs, views, RLS/grants); regenerate
  `database.types.ts`; define the frontmatter contract (§12) + the enforcing workflow artifact. *No
  UI.* Unblocks everything.
- **M2 — Classification & badges.** `item_type` classification menu, `TypeBadge`, the `task_items`
  read-path swap. Self-contained; ships value immediately (inbox triage).
- **M3 — Shell & Code view skeleton.** Tasks⇄Code switcher; remove Inbox button; `(code)` route group;
  `ProjectNav`; empty board scaffold + `CodeProvider`. Depends on M1.
- **M4 — The gate.** Send to Code / Convert to Code Story dialog + New-project / New-epic sub-dialogs;
  `enter_code_module` / `create_project` / `create_epic` wired optimistically; stories appear on the
  board. Depends on M1–M3.
- **M5 — Links & launch.** `buildRefinementUrl` / `buildImplementationUrl`; the await-write-then-open
  handler; phase-appropriate buttons on cards + modal. Depends on M4.
- **M6 — Detail modal.** Jira-style modal: spec render (placeholder until M7 snapshots exist), PR
  links, manual fallback controls. Depends on M4.
- **M7 — The Worker.** HMAC, parsing, transition table, spec snapshot; `wrangler.toml` secrets;
  per-repo setup docs. Depends on M1 + M12 contract. Can be built in parallel with M3–M6.

Routine slices (badges, atoms, API-route plumbing, Worker unit tests) are good sub-agent / mid-tier
work; schema, the state machine, the gate, and the Worker's transition logic want the strongest model.

---

## 17. Decisions resolved & still open

**Resolved (owner):** Projects & Epics are first-class tables; **stories** carry the lifecycle; epics
are lightweight groupings with their own shared-counter ref. A sent story **leaves the inbox** and
lives on **its project's board, in its epic, as a card in a state swimlane**. Refs are **per-project
exactly-3-char keys** (`ALF-42`), the key chosen in the **New project** dialog (name + GitHub link +
key), epics created via a **New epic** dialog; **epics and stories share one ref scheme**, and epics
can carry notes and be archived when done. The Code module
is a **new view** reached by a **Tasks⇄Code switcher** in the header; **Inbox button removed** (reach
inbox via the `alfred` wordmark, closed by default).

**Resolved (this spec's defaults — change deliberately):** spec render = **Option B snapshot**;
**no separate `spec_review` state** (refinement-PR-merged → `ready_for_dev` directly); enforcing
GitHub **check = committed Action**; Worker→GitHub auth = **fine-grained PAT** (GitHub App = upgrade
path); refinement/impl **links derived client-side**, not stored; PR-closed-unmerged **reverts**
rather than auto-abandons.

**Still open (flag at implementation, don't block):** exact Claude Code Web param names + prompt
length cap (§11.1 — verify via `claude-code-guide`); whether specs are edited post-merge often enough
to warrant `push`-event snapshot refresh (§13.3); the refinement-guide convention's exact path/shape
(`.alfred/refinement.md` proposed).

---

## 18. Reserved: Lane 1 (local-LLM implements, Claude reviews) — NOT built

Recorded so it isn't re-litigated, and so the schema doesn't fight it later. Lane 1 would have a local
model implement while **API-billed** Claude **reviews and steers** (a filter on cheap output, not a
generator). When built it must: (1) be a **scheduled dispatcher** over `ready_for_dev` stories with
`lane='local'` (no human link-click); (2) **gate on the existing deterministic back-pressure**
(typecheck/lint/unit) *before* Claude is invoked, so the reviewer only sees mechanically-passing code;
(3) **cap the review→fix loop** and instrument per-story cost; (4) bill against an **API key / Agent
SDK credits** (never the subscription). The `code_lane` enum + `code_items.lane` column exist for
exactly this; everything else in this spec (PR contract, Worker, board, detail modal) is lane-agnostic
and reused. **Do not build any of it now.**

---

## 19. Appendix

### 19.1 Environment & secrets

- **Worker (`wrangler.toml` secrets):** `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN` (fine-grained PAT,
  Contents:read on the project repos), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Frontend:** no new secrets (Claude Code links are public URLs; the modal reads the Supabase
  snapshot). Add the `react-markdown` + `remark-gfm` deps.

### 19.2 New/changed files (inventory)

- DB: `database/migrations/0002_software_factory.sql`; regenerated `frontend/lib/database.types.ts`.
- Frontend: `app/(code)/layout.tsx`, `app/(code)/[projectId]/page.tsx`;
  `components/code/*` (project-nav, board, swimlane, story-card, story-detail-modal, gate-dialog,
  new-project-dialog, new-epic-dialog); `components/tasks/type-badge.tsx`; edits to
  `components/tasks/folder-nav.tsx` (drop Inbox) + the shell layout (switcher) + `task-row.tsx`
  (classify / convert menu); `lib/stores/code-store.tsx`; `lib/code/links.ts`; `lib/api-client.ts`
  (+ projects/epics/code); `app/api/{projects,epics,code,code/[ref]}/route.ts`; `lib/data/items.ts`
  (read `task_items`).
- Worker: `workers/src/*` (handler, hmac, frontmatter, transitions, supabase, github), tests,
  `wrangler.toml`.
- Per project repo (one-time): `.github/workflows/alfred-frontmatter.yml`, a refinement-guide file,
  the GitHub webhook config.

### 19.3 Enforcing workflow (copy-ready sketch)

```yaml
name: alfred-frontmatter
on: { pull_request: { types: [opened, edited, synchronize] } }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Validate alfred frontmatter block
        env: { BODY: ${{ github.event.pull_request.body }} }
        run: |
          node -e '
            const b = process.env.BODY || "";
            const m = b.match(/```alfred\s+([\s\S]*?)```/);
            if (!m) { console.error("missing ```alfred block"); process.exit(1); }
            const blk = m[1];
            const ticket = /alfred-ticket:\s*(.+)/.exec(blk);
            const phase  = /phase:\s*(refinement|implementation)/.exec(blk);
            if (!ticket || !phase) { console.error("need alfred-ticket + phase"); process.exit(1); }
            if (phase[1] === "refinement" && !/spec-path:\s*\S+/.test(blk)) {
              console.error("refinement PRs need spec-path"); process.exit(1);
            }
            console.log("ok:", ticket[1].trim(), phase[1]);
          '
```

### 19.4 Glossary

**Project** repo container (has a key). **Epic** grouping bucket (has a ref). **Story** the ticket =
`items` row + `code_items` sidecar (refine→implement). **Ref** `KEY-N` human id, shared per-project
counter. **Factory state** lifecycle position (§5). **Lane** supervision mode (`human` now). **Gate**
the Project+Epic assignment that admits an item to the factory. **Snapshot** the Supabase copy of the
spec markdown the detail modal renders.
