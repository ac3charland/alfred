# Personal Task & Capture System — Technical Specification

> **Status:** MVP spec, ready for implementation handoff
> **Audience:** Coding agents (including Claude Code agent teams) and the project owner
> **Scope of this document:** Build the Tasks module as a standalone, frictionless capture-and-organize app, architected so that future modules (Reader, Communication Firewall, Software Factory, Knowledge Base) can plug into the same backend, auth, and shell without a redesign.

---

## 1. Project Overview & Goals

### The problem
The owner currently holds obligations, tasks, and ideas in their head and across scattered tools. There is no single trusted system to externalize into, which reduces focus and follow-through.

### The solution
A self-built, single-user task management app that prioritizes **frictionless capture** above all else. The owner controls the system end-to-end so that LLM-powered post-processing, classification, and routing can be layered in over time.

### Guiding principles
- **Capture first, organize later.** The default experience is a near-empty capture box. The user should never be ambushed by their backlog the moment they open the app.
- **YAGNI / incremental build.** Ship a real, useful to-do app first. Architect for the future, but do not build the future modules now.
- **Generic core, specific edges.** Everything enters as a generic *item*. Items are later refined/classified into specific destination types (task, code, knowledge). The core schema must not lock anything into being task-only.
- **TypeScript everywhere.** Frontend and backend share one language.
- **Device portability is a hard requirement.** The same data must be reachable from phone, personal desktop, and (optionally) work computer. All state lives in the backend; clients are thin.

### Scale expectations
- Order of **hundreds** of active items (historically ~200–300), not thousands. Plus completed items retained over time. Plan for comfortable growth, not for massive scale.

---

## 2. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (front to back) | One language across the whole stack; agent-friendly. |
| Frontend | **Next.js (App Router)** | Modern, static rendering out of the box, route-group encapsulation for future modules. |
| Frontend hosting | **Vercel** | First-class Next.js support; free tier is sufficient, paid is cheap (owner is fine with up to ~$10–20/mo total). |
| Data + Auth | **Supabase (PostgreSQL)** | Real relational DB for recursive/related data; built-in auth; good pricing; well-documented and agent-friendly; same instance reachable from all devices. |
| Server-side logic | **Cloudflare Workers** (deployed via **Wrangler**) | Serverless functions for LLM pre/post-processing and tool execution. Simpler deploy, negligible cold starts, transparent low-cost pricing vs. AWS Lambda. |
| Styling / UI | **Tailwind CSS** + **shadcn/ui** (Radix primitives) + **lucide-react** icons | De-facto modern, agent-friendly styling layer; shadcn components are copied into the repo (fully ownable, not a locked dependency) and themed via CSS variables — ideal for the dark, custom look in §5.4. See §5.5. |
| Infra-as-code | **`wrangler.toml`** in-repo per worker | Keeps infra code beside app code in the monorepo. |

### Notes on the stack decision path
- **Supabase over DynamoDB:** The data is relational (recursive subtasks, folder membership, item relationships). Postgres handles this far better and keeps costs predictable. DynamoDB was considered and rejected for this reason.
- **Cloudflare Workers over AWS Lambda:** AWS (with CDK in TypeScript) remains a viable fallback the owner is comfortable with, but Workers win for this use case on simplicity, cold-start latency, and cost for low/occasional traffic.
- **Migration path is intentional:** MVP uses simple Next.js API routes that talk directly to Supabase. When LLM processing is added, those routes are re-pointed at Cloudflare Workers, which then talk to Supabase. No rebuild required — swap the layer.

---

## 3. Data Model

### 3.1 Design philosophy
A minimal **generic item** is created on capture. Classification (manual now, LLM-assisted later) refines a generic item into a specific **item type** (the `item_type` field). The three types are:

1. **Task** — an actionable to-do (the only type built in the MVP).
2. **Code** — an idea/spec destined to become software (future: epics → stories → backlog → software factory).
3. **Knowledge** — a durable insight (future: extracted from articles/notes and indexed into a knowledge base).

The schema must allow a captured item — or an existing task — to be **converted** to another destination type later **without data loss or migration pain**. Keep the base generic; attach type-specific metadata only when classified.

### 3.2 Base item (generic)
Every item, regardless of type, carries:

- `id` — UUID
- `title` — string (the captured text / headline)
- `notes` — string, optional (longer body / detail)
- `source_url` — string, optional (e.g. when an article link is pasted)
- `item_type` — enum: `unclassified` | `task` | `code` | `knowledge`
- `created_at` — timestamp
- `raw_capture` — string, optional (the original unprocessed input, preserved for re-processing)

> Conversion = change `item_type` and attach the new type's metadata. Because the base never assumes "task," converting a captured to-do into a `code` or `knowledge` item later is a field change plus metadata enrichment, not a migration.

### 3.3 Task-specific model (MVP focus)
A task is an item with `item_type = task`, plus:

- `due_date` — date/datetime, nullable
- `status` — enum: `active` | `completed` (see completion behavior below). Active/completed is a task lifecycle and does not apply to `code` or `knowledge` items.
- `completed_at` — timestamp, nullable (set when completed).
- `folder_id` — UUID, nullable. `null` = the task lives in the Inbox (classified but not yet filed); a value = filed into that folder. Foldering is a tasks-module construct and does not exist on the generic item.
- `parent_id` — UUID, nullable. **Tasks are recursive to arbitrary depth.** Any task may have subtasks; any subtask is itself a full task and may have its own subtasks, with no depth limit.

> **Subtasks** are represented via `parent_id` self-reference (an adjacency list), which is the cleanest fit for arbitrary-depth recursion in Postgres and trivially queryable in Supabase. A task's subtasks are all items whose `parent_id` points to it.

### 3.4 Folders
- `id` — UUID
- `name` — string
- `created_at` — timestamp
- **Flat for now** (no nesting). Folders are organizational buckets a user moves *refined* tasks into. The Inbox is everything not filed into a folder — raw captured generic items (which have no `folder_id`) plus any task with `folder_id = null`.
- Folders carry **no special logic** — they are display containers. Nesting can be added later by giving folders an optional `parent_folder_id`; this is explicitly a future, low-cost extension and should not be built now.

### 3.5 Future destination metadata (do NOT build now — record for later)
- **Code item:** will carry generated epics/stories, refinement status, backlog/ready flags. Feeds the Software Factory.
- **Knowledge item:** will carry extracted insights, indexing/embedding references, and a link back to source article(s). Articles themselves are stored (link + text) but the *valuable insight* is what becomes knowledge.

### 3.6 Behaviors
- **Completion status:** Items default to `active`. Completed items are **hidden from default views** but **retained** in the database, with a `completed_at` timestamp. The UI offers a toggle / a dedicated view to show completed items (a "Completed" view or auto-folder).
- **Cascading completion:** Marking a **parent task complete** must show a **confirmation modal** warning that all subtasks will also be completed. If the user cancels, neither the parent nor the children change.

---

## 4. Capture (Input Paths)

### 4.1 In-app text field
A capture box is the **default landing view**. Submitting it creates a generic item in the Inbox with minimal friction.

### 4.2 Siri shortcut → API endpoint (MVP raw passthrough)
- The app exposes the secured item-create endpoint (`POST /api/items`) that accepts captured text and creates an Inbox item.
- A Siri Shortcut dictates text and `POST`s it to that endpoint.
- **MVP:** raw text is stored as-is (`raw_capture` + `title`).
- **Future:** an LLM "cleanup" middle layer (Cloudflare Worker) sits in front of storage to de-ramble voice input and pre-classify before the item lands in the Inbox.

### 4.3 Known Siri dictation pitfall (implementation note)
Siri's "Dictate Text" action can truncate input. Mitigations observed in the wild:
- Add a short (~2 second) **delay action before** the dictate action — this resolves a timing/race issue for many users.
- Use the Shortcuts app's **Dictate Text** action with its stop-listening controls tuned, rather than a generic Siri voice command.
- The future LLM cleanup layer also helps recover meaning from truncated/rambled input, making capture more forgiving regardless.

> Other capture ideas (Google Keep listener with a tag filter; a custom Claude/Siri skill with baked-in auth) were considered and **deferred** — the Siri-shortcut-to-endpoint path is the lowest-friction starting point.

---

## 5. Frontend Architecture

### 5.1 Shell pattern (built for growth)
A persistent shell with **top-level tabs** that switch the entire module context (sidebar + main content), modeled on the Claude desktop layout (tabs at the top of the sidebar). 

- **MVP:** effectively one module — **Tasks**. There may be zero visible tabs at first; the user sees the Tasks sidebar directly.
- **Future:** Reader, Firewall, Factory each become a tab. Selecting a tab swaps the sidebar contents and the main content area. Each tab is its own mini-app sharing the same backend, auth, and shell.

### 5.2 Routing & folder structure (Next.js App Router)
Use **route groups** so each module is self-contained and its folder structure mirrors its routing. A module's entire frontend lives inside its route group.

```
frontend/
├─ app/
│  ├─ layout.tsx              # top-level shell: auth gate, tab nav, header
│  ├─ (tasks)/                # ── MVP module ──
│  │  ├─ layout.tsx           # Tasks sidebar (Inbox + Folders) + content frame
│  │  ├─ inbox/page.tsx
│  │  ├─ folders/[id]/page.tsx
│  │  └─ completed/page.tsx
│  ├─ (reader)/               # future module (stub only)
│  ├─ (firewall)/             # future module (stub only)
│  └─ (factory)/              # future module (stub only)
├─ components/                # shared UI, OUTSIDE app/
│  ├─ atoms/                  # buttons, inputs, icons
│  ├─ molecules/              # composed widgets (task row, capture box)
│  └─ ...
├─ lib/                       # shared non-UI utilities, hooks, Supabase client
├─ package.json
└─ ...
```

- **Shared UI components** live in a top-level `components/` directory (outside `app/`), organized atoms → molecules, so any route group can import without coupling to a module.
- **Shared non-UI utilities/hooks** (including the Supabase client wrapper) live in `lib/`.

### 5.3 Core views & workflows (MVP)
- **Default view:** a clean capture box, minimal cognitive load. Capturing does not pull the user into refinement.
- **Sidebar navigation:** Inbox + Folders. Desktop = persistent left nav bar; mobile = hamburger menu that pops the nav out.
- **Inbox / folder list view:** a list of items. Tasks **expand inline** to reveal subtasks and metadata (due date, notes) directly in the UI — no required modal. The row expands as needed to show detail.
- **Completion:** completed items are hidden by default; a toggle or "Completed" view reveals them. Completing a parent triggers the cascade-confirmation modal (§3.6).
- **Organizing:** items move out of the Inbox into flat folders once refined.

### 5.4 Design Language

The visual direction is drawn from a reference the owner likes (StrongDM's "Software Factory" site): a **dark, modern, lightly-glowing** aesthetic — deep navy canvas, section-themed accent colors, soft outer glows on bordered cards, a high-contrast serif for big moments against a clean sans for everything else. Translate this to a **dense productivity UI**, not a marketing page: keep the palette, glow, type pairing, and structural devices, but apply restraint so task lists stay legible and scannable. Spend boldness in one place (the signature, below) and keep the rest quiet.

**Palette** (named tokens, defined as CSS variables; tune to taste):
- `--bg` deep navy / near-black, ~`#0A0E17`
- `--surface` translucent dark slate over the canvas, ~`#0F1626`
- `--border` cool slate, ~`#1E2A3F`
- `--text` near-white, ~`#E8EDF5`; `--text-muted` slate gray, ~`#8A96A8`
- **Accent system (multi-hue, themed per context):** `--accent-teal` ~`#4FD1E0` (primary / Tasks), `--accent-green` ~`#34D399`, `--accent-blue` ~`#60A5FA`, `--accent-amber` ~`#F0B429`. Each is used both as a border/text color and, at low alpha, as a soft outer-glow `box-shadow`.

> **Architecture tie-in:** the section-themed accents map naturally onto the top-level **modules** — e.g. Tasks = teal, Code/Factory = amber, Knowledge = green, Firewall = blue. Each tab/module carries its own accent so the whole system reads as one family while each area stays identifiable. (A deliberate alternative to the generic "one bright accent on black" look, which reads as AI-default.)

**Typography:**
- **Display (used sparingly):** a high-contrast serif for headline moments — section titles, empty states, the capture prompt. The reference reads like a Playfair-style high-contrast serif; **Playfair Display**, **Newsreader**, or **Instrument Serif** all fit.
- **Body / UI:** a clean grotesque sans for all dense content and controls — **Inter**, **Geist**, or **Space Grotesk**.
- **Eyebrow / overline:** small-caps, letter-spaced, accent-colored labels (e.g. `INBOX`, `THE LOOP`-style section markers). Use only where order/structure is real, not as decoration.

**Surfaces & glow:** cards and key rows are `--surface` fills with a 1px accent border and a soft, low-opacity outer glow in the same accent. Rounded corners (~`rounded-2xl` on cards, smaller on rows). Avoid glow everywhere — reserve it for focus, active, and section containers.

**Signature elements** (the memorable bits to carry over):
- **Eyebrow "notch" labels** that sit on a card's top border (overline label overlapping the edge).
- **Pill chips** — rounded-full outlined tags in an accent color (good for filters, metadata, quick-actions).
- **Pill nav** with an active-tab fill and a small status dot.
- Numbered/arrow **flow connectors** only where something is genuinely a sequence (e.g. a refinement pipeline) — not on flat lists.

**Motion:** restrained. Ambient glow, gentle scroll-reveal, hover lift on cards/pills, smooth expand/collapse for inline subtasks. Respect `prefers-reduced-motion`. Over-animation reads as AI-generated — less is more.

**Quality floor:** responsive to mobile (the hamburger nav from §5.3), visible keyboard focus, accessible color contrast on the dark canvas.

### 5.5 UI / CSS System

**Recommendation: Tailwind CSS + shadcn/ui (Radix primitives) + lucide-react icons.** Rationale: Tailwind is the most agent-friendly styling layer; shadcn/ui components are *copied into the repo* rather than installed as a black-box dependency, so they're fully ownable and themeable via CSS variables — which is exactly what the dark, custom, glow-heavy look in §5.4 needs. Define the §5.4 palette and type as CSS variables / Tailwind theme tokens once, in `globals.css` and the Tailwind config, and derive everything from them.

**On the two reference sites** (owner asked what they're built with):
- I could not definitively fingerprint either site's CSS framework — the fetch tool returns rendered text, not the underlying markup/class names, so Tailwind/shadcn/etc. can't be confirmed from here. Both look **custom-styled** rather than an off-the-shelf component kit's defaults.
- **jeremyronking.com** exposes a reader-facing **font switcher** built on Google Fonts, offering Space Grotesk, Playfair Display, Outfit, Sora, Inter, Fjalla One, Unica One, and Oswald. That's a reading-experience feature, not necessarily the framework — but it confirms a Google-Fonts-based type setup and a Playfair/grotesque sensibility consistent with §5.4.
- **To verify for yourself:** view source and look for Tailwind utility classes, `data-radix-*` / `data-state` attributes (shadcn/Radix), or `/_next/` chunks (Next.js); or run a tech-profiler browser extension (e.g. Wappalyzer) on each page.

---

## 6. API & Endpoints (MVP)

Start with simple **Next.js API routes** talking directly to Supabase. These are the seams that later re-point to Cloudflare Workers.

**Generic item CRUD** (`/api/items`) — anything that enters the system is a generic item:

- `GET /api/items` — list items (filter by folder / inbox / status; status and folder filters apply to tasks).
- `POST /api/items` — create a generic Inbox item. This is the single capture/ingest path, used by **both** the in-app capture box and the Siri shortcut. Accepts an authenticated session (in-app) **or** a valid API key (external/Siri ingress). This is also the seam where the future LLM capture-processing Worker slots in.
- `PATCH /api/items/:id` — update item (title, notes, due date, folder, parent, item_type).
- `DELETE /api/items/:id` — delete item.

**Task-scoped actions** (`/api/tasks`) — operations that only make sense for the task lifecycle live under their own namespace, separate from generic item CRUD:

- `POST /api/tasks/:id/complete` — complete a task; if it has subtasks, the client first confirms via the cascade modal.

**Folders** (`/api/folders`):

- `GET/POST/PATCH/DELETE /api/folders` — folder CRUD.

> When LLM processing is introduced, `POST /api/items` (and any classification endpoints) re-point to a Cloudflare Worker that pre-processes/classifies, then writes to Supabase. Tool definitions for discrete item actions (create/classify/tag/route) are defined **in the Worker** and passed to the LLM provider in the request `tools` payload; the Worker executes the tool calls against Supabase and returns results.

---

## 7. Authentication & Security

Single user, but **no security-by-obscurity**.

- **Frontend gate:** **Supabase Auth** with a single user account (the owner). The Next.js shell requires login; no data is visible until authenticated. Supabase handles sessions.
- **Downstream of the frontend:** secure Supabase and Cloudflare Workers using **API keys stored in environment variables** (Vercel env vars; Worker secrets via Wrangler). The frontend/Workers present the key when calling protected services; Workers also validate an API key on inbound calls (e.g., the capture endpoint).
- Supabase **Row-Level Security** is **mandatory** — the project has deny-by-default RLS enabled at creation. Every new table must `ENABLE ROW LEVEL SECURITY` and carry an explicit policy, or it will be fully inaccessible via the Data API. This is a deliberate security decision: the publishable key ships to the browser and is public — RLS (not the auth gate) is what prevents a leaked key from reading/writing Postgres directly. Use the `authenticated full access` pattern (`using (true) with check (true)`) — no `user_id` column is needed and none should be added (single-user app, role-based not row-based). Server-side code (API routes, Workers) uses the secret key and bypasses RLS by design; never disable RLS or remove a policy because of this asymmetry.

---

## 8. Monorepo Layout (top level)

```
repo/
├─ frontend/             # Next.js app (see §5.2) — deploys to Vercel; owns its tooling config + check:fast/check:slow
├─ workers/              # Cloudflare Workers (TypeScript) + wrangler.toml per worker — deploys via Wrangler; owns check:fast
├─ database/             # Supabase migrations / SQL schema (optional but recommended)
├─ .husky/               # root git hooks: pre-commit → check:fast, pre-push → check:slow, commit-msg → commitlint
├─ commitlint.config.*   # single repo-wide commit rules (§9.3)
├─ package.json          # root: npm workspaces; check / check:fast / check:slow fan out to every package (see §9.1)
├─ CLAUDE.md             # agent guidance: model-assignment rules (§12) + back-pressure hard rules (§9.4) + compounding-learning rule (§10.2)
└─ README.md
```

Everything lives in one repo (npm workspaces) so coding agents have full context and can change frontend, workers, and schema coherently. Each code-bearing package owns its own tooling config (tsconfig, ESLint, Prettier, Jest, etc.) and its tiered `check:*` scripts; husky lives once at the root and fans out to them (§9.3).

---

## 9. Testing, Linting & Back-Pressure

Deterministic, fast, frequently-run suites are the **back-pressure** that steers code generation toward correct, idiomatic code. For the suites to steer effectively they must have teeth: agents satisfy them by fixing the *code*, never by loosening the guardrails (see §9.4).

**Pyramid-shaped, fail-fast.** A wide base of cheap, fast checks (type-check, lint, unit) and a narrow top of slow, expensive ones (snapshot, E2E). Checks run cheapest-first and stop on first failure, so the most common problems surface in seconds, not minutes.

**Set up first.** Everything below is configured in every code-bearing top-level package **before any feature code is written** (see Phase 0).

### 9.1 The `check` command (tiered)
Each code-bearing package splits its checks into two tiers, so the cheap ones gate **commits** and the expensive ones gate **pushes**. Each tier runs in order, stopping on first failure.

**`check:fast` (pre-commit)** — cheap, runs in seconds:
1. **Type-check** — `tsc --no-emit`.
2. **Lint + format** — ESLint with `--fix --cache`, then Prettier with `--cache`. The rule set is tuned to catch anti-patterns automatically, *not* for human ergonomics: **prefer `error` over `warn`** and enable each plugin's recommended/best-practice config. Prettier config: `singleQuote: true`, `tabWidth: 2`, plugin `@trivago/prettier-plugin-sort-imports`. Use `eslint-config-prettier` so ESLint defers formatting to Prettier.
3. **Unit tests** — Jest (+ **React Testing Library** on the frontend). Tests live **alongside their source files** (`foo.ts` → `foo.test.ts`), never in a top-level `__tests__/`.

**`check:slow` (pre-push)** — expensive, frontend only:
4. **UI / snapshot tests** — **Storybook** (test-runner / snapshot tests).
5. **E2E tests** — **Playwright**.

**`check`** = `check:fast` then `check:slow` — the full suite, for manual runs and CI.

Each package defines whichever of these scripts apply (`workers/` has no `check:slow`). The **root** exposes the same three scripts, each fanning out to every package via the workspace runner (`npm run <script> --workspaces --if-present`), so packages missing a tier are skipped gracefully. Always pass `--cache` to ESLint/Prettier for speed.

### 9.2 ESLint plugin set (aggressive, errors-preferred)
Land on a plugin set that lints hard and escalates warnings to errors wherever feasible:
- `@typescript-eslint` with **type-aware** rules (`strict-type-checked` + `stylistic-type-checked`)
- `eslint-plugin-import` (import validation/ordering) and `eslint-plugin-unicorn` (broad anti-pattern coverage)
- **Testing:** `eslint-plugin-jest`, `eslint-plugin-jest-dom`, `eslint-plugin-testing-library`
- **Frontend only:** `eslint-plugin-react`, `eslint-plugin-react-hooks`, `@next/eslint-plugin-next` (core-web-vitals), `eslint-plugin-jsx-a11y`, `eslint-plugin-storybook`, `eslint-plugin-playwright`
- `eslint-config-prettier` (disables formatting rules that fight Prettier)

The `workers/` package drops the React/Next/Storybook/Playwright/RTL plugins and keeps TS + import + unicorn + jest.

### 9.3 Git hooks (husky + commitlint) — root-level, fanning out
Git hooks are repo-global (one `.git/hooks`), so **husky is installed once at the repo root** (root `package.json` `prepare: "husky"`; hook scripts in `.husky/`). The root hooks call the root orchestrator scripts, which fan out to each package's scripts via the workspace runner — that's how a single husky setup drives service-level checks without per-package hook installs:

- **pre-commit** → root `check:fast` (→ each package's `check:fast`). Optionally wrap with **lint-staged** so ESLint/Prettier only touch *staged* files, routed to the right package by path.
- **pre-push** → root `check:slow` (→ the frontend's Storybook + Playwright; other packages skipped via `--if-present`).
- **commit-msg** → **commitlint** using a single root `commitlint.config.*`, enforcing Conventional Commits:
  - subject **required**, scope **required**
  - body **always empty**, footer **always empty** (one-line commits)
  - subject case **lowercase**
  - e.g. `feat(backpressure): lowercase conventional commit`

As the repo grows, an optional **Turborepo/Nx** layer can run only affected packages and cache results (e.g. `turbo run check:fast --filter=...[HEAD]`) to keep hooks snappy.

### 9.4 CLAUDE.md hard rules (guardrail integrity)
Specified in the top-level `CLAUDE.md`, non-negotiable:
- **Forbidden:** editing tooling config (ESLint / Prettier / tsconfig / Jest / Playwright / commitlint / husky) to make a check pass.
- **Forbidden:** adding ignore/disable directives to force a pass — `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `// prettier-ignore`, `.skip` / `.only` tests, etc.
- **Forbidden:** bypassing the hooks (`git commit --no-verify`, `git push --no-verify`).
- The hooks enforce the suites automatically — **pre-commit runs the fast tier, pre-push runs the slow tier** — so the agent doesn't need to run `check` manually before committing. It should simply be aware that commits and pushes are gated, and may run `check:fast` / `check:slow` / `check` anytime to iterate.
- Failures are fixed in the *code*, never by weakening the guardrails.

---

## 10. Skills & Compounding Learning (Memory Layer)

Agent knowledge is treated as a durable, compounding asset. Two mechanisms work together: **deterministic back-pressure (§9)** prevents regressions mechanically, while **skills** prevent *repeated discovery cost* — the price of re-learning the same gotcha. Before any tooling or feature code, the swarm authors a **skill** (a `SKILL.md`) for every major framework in the stack. Thereafter, every non-obvious problem an agent solves is written back into the relevant skill, so the same wall is hit at most once across the whole swarm and across sessions.

### 10.1 Framework skills to author (pre-Phase-0)
One `SKILL.md` per framework below. Each captures: this project's setup/config, idioms and best-practices, and a **running list of gotchas/footguns** discovered over time.

- **Frontend & UI:** Next.js (App Router; also covers Vercel deploy), React, Tailwind CSS, shadcn/ui (incl. Radix primitives + lucide-react)
- **Data, auth & backend:** Supabase (Postgres, Auth, RLS, client SDK), Cloudflare Workers (+ Wrangler), Anthropic API / LLM tool-use
- **Testing & quality:** Jest, React Testing Library, Storybook, Playwright, ESLint (also covers the aggressive plugin set, Prettier, and `@trivago/prettier-plugin-sort-imports`), commitlint (also covers husky + the one-line Conventional Commits rules)
- **Monorepo & language:** npm workspaces (root orchestration; Turborepo/Nx notes if adopted), TypeScript (strict `tsconfig`, type-aware patterns)

These are authored **first** — before the Phase 0 testing/lint/back-pressure setup — so the very work of standing up the toolchain already accrues learnings into skills.

### 10.2 The compounding-learning rule (in CLAUDE.md)
When an agent hits and resolves a setback or non-obvious problem, it must record the insight before moving on:

1. **Framework-related** → update that framework's existing skill (from §10.1) with the insight/gotcha.
2. **Not framework-specific** (a gotcha with a service, a piece of functionality, an integration, a config interaction, etc.) → find an existing skill for that area of concern and update it; if none exists, **create a new skill** for that concern.

Agents **read the relevant skills before starting related work**, so accumulated gotchas are surfaced proactively rather than rediscovered. The goal is simple: each problem is encountered at most once.

---

## 11. Implementation Phases

Each phase is sized to be tractable for an individual agent session. Phases are ordered; within a phase, bullets are candidate parallelizable tasks.

### Phase 0 — Framework Skills, Scaffolding & Quality Guardrails
- **First, author the framework skills (§10.1)** — one `SKILL.md` per framework — *before* standing up the toolchain, so even the setup work below accrues learnings into them.
- Initialize monorepo (`frontend/`, `workers/`, `database/`, root `package.json`, `CLAUDE.md`, `README.md`).
- Bootstrap Next.js (App Router, TypeScript) in `frontend/`.
- Install Tailwind CSS + shadcn/ui + lucide-react; establish the §5.4 palette and type as CSS variables / Tailwind theme tokens in `globals.css` and the Tailwind config (§5.5).
- **Stand up the full testing/lint/back-pressure stack in every code-bearing package *before any feature code* (§9):** strict `tsconfig`; ESLint (aggressive plugin set, errors-preferred, `--fix --cache`); Prettier (`singleQuote`, `tabWidth: 2`, trivago import-sort, `--cache`); Jest (+ RTL on the frontend, tests co-located); Storybook + Playwright (frontend); tiered `check:fast` / `check:slow` / `check` scripts per package plus root orchestrators over npm workspaces; root husky wiring (pre-commit → `check:fast`, pre-push → `check:slow`, commit-msg → commitlint); and write the §9.4 hard rules **and the §10.2 compounding-learning rule** into `CLAUDE.md`.
- **Gate:** confirm the root `npm run check` passes green on the empty scaffold before starting Phase 1.
- Create Supabase project; wire env vars locally and in Vercel.
- Stand up the Supabase client wrapper in `frontend/lib/`.

### Phase 1 — Data layer
- Define schema in `database/`: `items` (base + task fields, `parent_id` self-reference), `folders`.
- Apply migrations to Supabase.
- Seed a tiny dataset for development.

### Phase 2 — Auth gate
- Integrate Supabase Auth; single-user login.
- Top-level `app/layout.tsx` blocks all content until authenticated.

### Phase 3 — Core API routes
- Implement `/api/items` (incl. the merged create/ingest path), `/api/folders`, and the task-scoped complete/cascade endpoint `/api/tasks/:id/complete` (§6).
- API-key validation on `POST /api/items` for the external/Siri ingress path (session auth for in-app calls).

### Phase 4 — Tasks UI (the MVP heart)
- Build the shell: header + (single) Tasks tab + responsive sidebar (left nav desktop / hamburger mobile).
- Default capture-box view.
- Inbox + folder list views with **inline-expanding** task rows showing subtasks + metadata.
- Recursive subtask rendering and creation (arbitrary depth).
- Due date + notes editing inline.
- Completion with hide-by-default, a Completed view, and the **cascade-confirmation modal**.
- Move items between Inbox and folders; folder CRUD.
- Shared atoms/molecules in `components/`.

### Phase 5 — Capture integration
- Siri Shortcut: dictate → `POST /api/items` with an API key. Apply the delay-before-dictate mitigation (§4.3).
- Verify cross-device access (phone web-shortcut, desktop, optional work machine).

### Phase 6 — (Future) LLM processing layer
- Stand up first Cloudflare Worker via Wrangler.
- Re-point `/api/capture` to the Worker for voice cleanup + pre-classification.
- Define item-action tools in the Worker; pass to the LLM provider; execute tool calls against Supabase.

---

## 12. Building This With Coding Agents

This spec is larger than a single agent session, so the build assumes **agent swarms** (Claude Code agent teams): a **lead/orchestrator** agent owns the architecture and this spec, decomposes the work into the phases in §11, and delegates parallelizable tasks to **specialist teammates** working against a shared task list with dependency tracking and inter-agent messaging.

### Swarm shape
- **Lead (orchestrator):** holds the architecture (§§3, 5), maintains the shared task list, sequences phases, reviews teammate output, and integrates. Owns nothing implementation-level directly.
- **Specialist teammates**, mapped to the §11 phases:
  - *Schema* — Phase 1 data layer (`items`, `folders`, migrations).
  - *API* — Phase 3 routes (`/api/items`, `/api/tasks`, `/api/folders`).
  - *Frontend* — Phase 4 Tasks UI (shell, capture box, inbox/folder views, recursive subtasks).
  - *Auth* — Phase 2 Supabase auth gate.
  - (Later) *Workers* — Phase 6 LLM processing.

### Dependency ordering (what the shared task list must enforce)
- **Phase 0 (framework skills §10.1, then scaffolding + back-pressure guardrails §9) must finish first** and the root `npm run check` must pass green before any teammate writes feature code.
- **Phase 1 schema** is the next gate; API and Frontend both depend on it.
- Auth (2), API (3), and the non-data parts of the UI shell (4) can then proceed largely in parallel; data-bound UI waits on the API contract.

### Model assignment
Run the lead on the strongest reasoning model and route implementation/routine work to a cheaper model. Specify this in `CLAUDE.md`:

```
## Model Assignment Rules
- Lead / architecture / reviews: strongest model
- Teammate implementation and routine edits: mid-tier model
- File discovery / simple lookups: fast/cheap model
```

The **`opusplan`** alias is a useful built-in for the lead: top reasoning model in plan mode, auto-switching to the mid-tier model for execution.

### Guardrail integrity across the swarm
Every teammate is bound by the §9.4 hard rules: the pre-commit and pre-push hooks gate every commit and push automatically (fast tier on commit, slow tier on push), and teammates may not weaken config, add ignore/disable directives, or bypass hooks with `--no-verify`. The deterministic suites are what keep parallel agents from drifting — they are the shared definition of "done."

### Operating the swarm
- **Enable:** set env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (shell or `settings.json`).
- **Use:** point the lead at this spec, tell it to create an agent team, and have it build the shared task list from §11 — starting with authoring the framework skills (§10.1); it spawns and coordinates teammates from there.

> Verify current model IDs and the agent-team flag against Claude Code's live docs before kicking off, as these change frequently.

---

## 13. Future Directions (architectural awareness — NOT in MVP)

The Tasks module is the first tenant of a broader **personal information processing system** whose job is to ingest everything entering the owner's life — communications, reading, and their own ideas — and reduce the friction of classifying, planning, and acting on it. All modules share the same backend, auth, shell, and generic-item core; each adds its own tab, sidebar, and processor (typically a Cloudflare Worker).

1. **Reader (newsletter digest).** An LLM reads subscribed newsletters and extracts **novel insights**. A reader UI lets the owner skim those points to decide what's worth reading, with a second, slightly fuller summary layer for getting the gist without reading in full. Articles flow toward **knowledge**: the article (link + text) is stored, but the extracted insights are what get indexed into the knowledge base.

2. **Communication Firewall.** An LLM with access to email / messaging (e.g. WhatsApp) **triages incoming messages by priority and urgency** — immediate-response items surfaced first, end-of-day items in another tier, low-urgency below that — presented in a dedicated triage UI.

3. **Software Factory.** `code`-type items (e.g. "build the communication firewall") are transformed into **JIRA-style epics and stories**, refined with coding agents into discrete, development-ready backlog tasks. A coding agent checks the backlog on a schedule, implements what's ready, and **opens PRs** for later review. Likely surfaced as a Kanban-style board.

4. **Knowledge Base.** A durable, indexed store of extracted insights (from articles and from prose the owner captures), feeding retrieval across the system.

### Architectural implications carried into the MVP
- The **generic-item core** and the explicit `item_type` field exist so captured items can be **converted** into `code` or `knowledge` later without migration pain. The owner can capture "build X" today as a task and promote it to a code item once that module exists.
- The **route-group shell** means new modules are added as new `(group)`s + a tab, not a redesign.
- The **API-route → Worker** seam means LLM processing slots in without reworking the frontend.