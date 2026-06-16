# CLAUDE.md — Agent Guidance for `alfred`

`alfred` is a single-user, TypeScript, capture-first personal task system. The
full design lives in [`docs/SPEC.md`](docs/SPEC.md); read it before making
architectural decisions. This file holds the **non-negotiable operating rules**
for every agent (lead and teammates) working in this repo.

## Monorepo at a glance

npm workspaces, one repo so agents have full context:

- `frontend/` — Next.js (App Router) → Vercel. Owns `check:fast` + `check:slow`.
- `workers/` — Cloudflare Workers (Wrangler). Owns `check:fast` (no `check:slow`).
- `database/` — Supabase migrations / SQL schema.
- `tools/` — repo-local dev tooling. `tools/showboat` is the self-contained demo-doc
  CLI (run via `npm run demo`; see the `showboat` skill). Owns `check:fast`.
- `.husky/` — root git hooks (one `.git/hooks` for the whole repo).
- `.claude/skills/` — the compounding skill library (see §10.2 rule below).

Each code-bearing package owns its own tooling config and tiered `check:*`
scripts. The **root** exposes `check`, `check:fast`, and `check:slow`, each
fanning out to every package via `npm run <script> --workspaces --if-present`.

---

## Installing Packages

Before committing or pushing, make sure you've installed node_modules.

**Always use `npm ci` over `npm install`** unless you're adding/removing dependencies.

If tool binaries (e.g. `jest`) are not found, `node_modules` has not been installed yet — run `npm ci` before proceeding.

If `package-lock.json` shows changes after running commands but no packages were added or removed, **revert those changes** before committing — they are spurious metadata drift (e.g. `"dev": true` annotations) that npm regenerates non-deterministically and should not be committed.

---

## Back-pressure: hard rules (guardrail integrity)

The deterministic suites (type-check, lint/format, unit, snapshot, E2E) are the
**back-pressure** that steers generation toward correct, idiomatic code. They
are the shared definition of "done" across the swarm. They only work if they
keep their teeth. **Failures are fixed in the _code_, never by weakening the
guardrails.** The following are strictly forbidden:

- **Do not edit tooling config to make a check pass** — this includes ESLint,
  Prettier, `tsconfig`, Jest, Storybook, Playwright, commitlint, and husky
  config. (Editing these to legitimately add/adjust project rules is a separate,
  deliberate task — never a reaction to a red check.)
- **Do not add ignore / disable directives to force a pass** — no
  `eslint-disable` (any variant), `@ts-ignore`, `@ts-expect-error`,
  `// prettier-ignore`, or `.skip` / `.only` on tests.
- **Do not bypass the hooks** — never `git commit --no-verify` or
  `git push --no-verify`. The **sole exception** is the `batch-commits` skill's
  bundled script (`node .claude/skills/batch-commits/scripts/batch-commit.mjs
  <file>`): it runs the full `check:fast` gate **once** against the complete
  working tree, validates every commit message
  with commitlint up front, and then applies `--no-verify` only to skip the
  *redundant* re-runs on the remaining commits of the same batch (`pre-push` /
  `check:slow` stays intact). That's "run the meaningful check once," not a bypass.
  Outside that tool, `--no-verify` remains forbidden.

### When a rule seems wrong, file a lint suggestion — don't silently work around it

Sometimes a rule, or a *combination* of rules, fights you in a context where it
genuinely doesn't make sense. The hard rules above still hold — you do **not**
disable it, weaken config, or add an ignore directive on your own. Instead:

1. **Make your code pass the gate as it stands.** (A legitimate, deliberate
   project-rule change is its own task — never a reaction to a red check.)
2. **Drop a note in the lint-suggestion inbox** at
   [`docs/lint-suggestions/`](docs/lint-suggestions/) — **one markdown file per
   issue**, named for the problem (e.g. `no-empty-function-in-stories.md`),
   following the template in that folder's `README.md`. Explain the rule(s), the
   context where they don't fit, and a concrete suggested change. **Add this file
   before moving on** — the same turn you hit the friction.

This keeps the guardrails intact while routing real friction toward a deliberate,
reviewed decision instead of an ad-hoc bypass.

### How the gates run

The hooks enforce the suites automatically, so you do **not** need to run
`check` manually before committing:

- **pre-commit** → root `check:fast` (type-check → lint+format → unit).
- **pre-push** → root `check:slow` (frontend Storybook snapshots + Playwright E2E).
- **commit-msg** → commitlint (one-line Conventional Commits: subject + scope
  **required**, body and footer **always empty**, subject **lowercase**, e.g.
  `feat(backpressure): lowercase conventional commit`).

You may run `check:fast`, `check:slow`, or `check` anytime to iterate. Just be
aware that every commit and push is gated.

### Always run checks through an `npm run` script — never a tool binary directly

Every check must take the form of `npm run <script>` in some directory — the
**root** (fans out to all packages) or a **specific package** (`npm run lint -w
frontend`). **Never invoke a tool binary directly** — no `npx eslint <file>`, no
`./node_modules/.bin/prettier --check <file>`, no bare `tsc`/`jest`. Doing so
bypasses the package's configured scope and ignore lists, so it reports
misleading results: e.g. running Prettier straight at a path flags files that
are deliberately outside any package's format scope (the `.claude/skills/*.md`
prose lives at the repo root and no package formats it), producing "failures"
that the real gates never see. The `npm run <script>` indirection **is** the
source of truth for what each check covers.

If you need a check over a particular set of files and no script gives you that,
**add or modify a `package.json` script** so the capability is reproducible and
shared — then run that. Adding the script you needed is the correct move; reaching
for the raw binary is not.

### Generated files are excluded from formatting & linting

Generated output is the generator's to own, not ours. **Never hand-edit or
reformat a generated file** — reproduce it by re-running its generator and commit
that raw output verbatim. Every generated artifact must be ignored by **both**
ESLint and Prettier so the guardrails don't fight the generator:

- Supabase schema types — `frontend/lib/database.types.ts` (regenerate with
  `supabase gen types`).
- Anything matching `*.gen.ts`.
- Framework-emitted files — e.g. `next-env.d.ts`, `worker-configuration.d.ts`.

Keep the ESLint `ignores` and the `.prettierignore` lists in sync when a new
generated artifact appears. Adding a newly-generated file to those ignore lists
is the expected, deliberate config change — **not** a guardrail bypass (the "don't
weaken config" rule above is about silencing a check on _hand-written_ code).

---

## Workflow: 

### Implemenation: TDD

When implementing work, unless told explicitly not to, use Red/Green TDD.

Every change to the app's functionality should impact **at least one** test. Not necessarily always unit tests, but either a unit, Storybook, or e2e test. We aren't aiming for 100% unit test coverage, but we **ARE** aiming for 100% confidence in the behavior of our app when we run the `check` commands. That means every requirement of the app must be expressed somewhere, either explicitly or implicitly, in a test. If you were to make a change without updating tests and nothing broke, that would be a failure of our testing strategy.

### Demonstrating changes: the demo doc

Tests prove a change **doesn't regress**; a **demo doc** proves the new behavior
**actually happens** — and lets a reviewer reproduce it with one command. Unless told
otherwise, once a user-facing or behavioral change is working and `check` is green,
capture it as a demo doc at `docs/demos/<feature-or-branch>.md` using the
self-contained demo CLI (no extra runtime, works the same locally, in Claude Code for
web, and in the sandbox):

- `npm run demo -- init docs/demos/<name>.md "<title>"` to start it.
- `npm run demo -- note …` to narrate; `npm run demo -- exec <file> <lang> "<cmd>"` to
  run the relevant commands / tests / requests and capture their output.
- For UI changes, screenshot the running app with
  `npm run screenshot -w frontend -- <url> shot.png` and embed it via
  `npm run demo -- image …`.
- For a change that **moves a committed visual snapshot** (the Storybook atoms), the demo
  evidence is the **diff image** the snapshot gate auto-emits — embed it, then **approve**
  the new baseline (`npm run test:storybook:update -w frontend`) and commit the regenerated
  PNG(s) with the demo doc. See the `storybook` skill (§7) for the full capture-then-approve
  flow; never hand-edit a baseline.
- Confirm it reproduces with `npm run demo -- verify docs/demos/<name>.md` before you
  wrap up.

**Read the `showboat` skill first** for the full command set and authoring tips
(keep `exec` blocks deterministic so `verify` stays green). Trivial,
non-behavioral changes (pure refactors, docs, config) don't need a demo doc.

### End of Workflow: committing, pushing & PR

When you finish a task, **unless the user tells you not to**, wrap it up like this:

1. **Never commit on `main`.** Check the current branch first; if it's `main`, create a feature branch and switch to it before committing.
2. **Commit your changes, grouped by concern.** Don't dump everything into one commit — stage and commit related changes together so each commit is a single logical unit. Include the demo doc from *Demonstrating changes* (e.g. `docs(demos): …`). Every message follows the commitlint format (one-line Conventional Commits: subject + scope **required**, body and footer **always empty**, subject **lowercase** — e.g. `feat(tasks): add inline subtask rows`). **When a finished change needs more than one commit, you MUST commit them with the `batch-commits` skill — never run `git commit` once per group.** Each manual commit re-runs the whole `check:fast` gate, so N commits pay that cost N times; the skill (`node .claude/skills/batch-commits/scripts/batch-commit.mjs <input-file>`) runs the gate once up front, then creates every commit, skipping the redundant re-checks. See `.claude/skills/batch-commits/SKILL.md`.
3. **Push** the branch to the remote.
4. **Open or update the pull request — and keep its description in sync.** A PR's
   description is the canonical record of what the PR does; reviewers read it, not your
   chat history. So treat it as a **living document that must match the branch's current
   content at all times**:
   - **No PR exists yet?** Open one from the feature branch into `main` once the full
     feature is done. **Link the demo doc as a _live, clickable_ link** in the description
     — generate it with `npm run demo -- pr-link docs/demos/<name>.md` (emits a GitHub blob
     URL on the head branch, **not** a bare path, so reviewers can open it and see the
     embedded screenshots/diffs rendered). See the `showboat` skill.
   - **A PR already exists?** (Including one you opened earlier this session, or one the
     UI/another agent created.) **Every time you push a change that alters what the PR does
     — a new commit, a follow-up fix, a rename, an added file — update the description in the
     same turn so it reflects the new state**, and add the demo link if it's still missing.
     This is not a one-time step at PR creation: it recurs for *every* content change you
     push to a branch that has an open PR. A description that's gone stale relative to the
     branch is a bug to fix, exactly like a failing check.

The pre-commit (`check:fast`) and pre-push (`check:slow`) hooks gate each step
automatically — fix any failures in the **code**, never with `--no-verify` or by
weakening config (see the hard rules above).

#### Skipping steps

Being told to skip a step implies skipping all later steps as well:

- Skip committing → also skip pushing and opening a PR.
- Skip pushing → also skip opening a PR.
- Skip opening a PR → does **not** imply skipping committing or pushing.
- Skip the demo doc → still commit / push / open the PR as normal, just without it.

---

## Editing the skill library is high-leverage — slow down

A skill steers **every future agent** in the swarm, so a mistake in one — wrong guidance, a
description that misfires, stale text — compounds across sessions instead of being caught
once. Treat any change under `.claude/skills/` as higher-stakes than app code, and read the
relevant meta-skill **before** you touch it:

- **Creating a skill** → read the `skill-creator` skill first.
- **Updating a skill** → read the `compounding-learning` skill first (the house style for
  *how* to record: lean, current, right altitude, no duplication, no narration of the edit).
- **Either way** → the `skill-lint` skill documents the gate your edit must pass. Run
  `npm run lint:skills -w tools/skill-lint` **while drafting**, not just at commit, so its
  feedback lands before you've moved on.

**The `description` is the highest-leverage line and the easiest to get wrong** — it's the
only text an agent sees when deciding whether to load the skill. Don't write it from memory:
after drafting, **walk the `skill-creator` "Writing a description that triggers" checklist
line by line against your draft** (and skim its `references/description-examples.md` before/after
library) and fix each miss. The failures that recur across the library are inlining the body's 
guidance and burying the distinctive keywords past the first ~250 chars. `skill-lint` catches 
the mechanizable smells; the rest are yours to check, every time.

---

## Compounding-learning rule (memory layer)

Agent knowledge is a durable, compounding asset. Back-pressure prevents
regressions mechanically; **skills prevent _repeated discovery cost_** — the
price of re-learning the same gotcha. The skill library lives in
`.claude/skills/` — one `SKILL.md` per **area of concern**. That's not only app
frameworks (Next.js, React, Tailwind, shadcn/ui, Supabase, Cloudflare Workers,
Anthropic API, Jest, RTL, Storybook, Playwright, ESLint, commitlint, npm
workspaces, TypeScript, …) but also the **developer tooling and CLI workflows**
the swarm leans on (git, the GitHub CLI → `gh-cli`, the deploy CLIs `vercel` /
`wrangler` / `supabase`, `psql`, …). A reproducible quirk in any of those is
just as skill-worthy as a framework gotcha.

These skills are **alfred-specific** even when named for a library: a skill like `react`
or `supabase` blends that library's reference with this project's own conventions and
gotchas, so a description that says `Covers <library>` already implies "as used in alfred"
and needn't spell that scope out.

**Read the relevant skill(s) before starting related work** so accumulated
gotchas surface proactively instead of being rediscovered.

When you hit and resolve a setback or **non-obvious** problem — at *any* stage,
including the commit → push → PR → deploy wrap-up, not just while writing feature
code — record the insight **before moving on**. **Read the `compounding-learning`
skill (`.claude/skills/compounding-learning/SKILL.md`) before you do** — it's the house
style for *how* to record (lean, current, right altitude, no duplication, no narration
of the edit), plus a library of before/after examples. Route the insight like so:

1. **Tied to a specific framework, library, service, CLI, or tool** → update that
   tool's existing skill (Next.js, React, Supabase, Playwright, `git`, `gh`,
   `wrangler`, `psql`, husky, …).
2. **Not tied to any one tool** — a cross-cutting project convention, house-style
   decision, or architectural pattern → it belongs in a house-style skill like
   `data-flow` or `motion`. Update the existing skill for that area of concern, or
   **create a new one if none fits**.

"It was just a one-off CLI hiccup" / "a quick workaround" is exactly the
rationalization to resist: if it cost discovery time and could recur, it's a
skill — record it the same turn you fix it, without being asked. The goal is
simple: **each problem is encountered at most once** — across the whole swarm and
across sessions.

---

## Model Assignment Rules

Run the lead on the strongest reasoning model and route routine work down-tier:

- **Lead / architecture / reviews:** strongest model.
- **Teammate implementation and routine edits:** mid-tier model.
- **File discovery / simple lookups:** fast/cheap model.


