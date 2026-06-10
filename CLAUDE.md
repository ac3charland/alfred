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
- `.husky/` — root git hooks (one `.git/hooks` for the whole repo).
- `.claude/skills/` — the compounding skill library (see §10.2 rule below).

Each code-bearing package owns its own tooling config and tiered `check:*`
scripts. The **root** exposes `check`, `check:fast`, and `check:slow`, each
fanning out to every package via `npm run <script> --workspaces --if-present`.

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
  `git push --no-verify`.

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

## Workflow: committing, pushing & PR

When you finish a task, **unless the user tells you not to**, wrap it up like this:

1. **Never commit on `main`.** Check the current branch first; if it's `main`,
   create a feature branch and switch to it before committing.
2. **Commit your changes, grouped by concern.** Don't dump everything into one
   commit — stage and commit related changes together so each commit is a single
   logical unit. Every message follows the commitlint format (one-line
   Conventional Commits: subject + scope **required**, body and footer **always
   empty**, subject **lowercase** — e.g. `feat(tasks): add inline subtask rows`).
3. **Push** the branch to the remote.
4. **Open a pull request** from the feature branch into `main` once the full
   feature is done.

The pre-commit (`check:fast`) and pre-push (`check:slow`) hooks gate each step
automatically — fix any failures in the **code**, never with `--no-verify` or by
weakening config (see the hard rules above).

### Skipping steps

Being told to skip a step implies skipping all later steps as well:

- Skip committing → also skip pushing and opening a PR.
- Skip pushing → also skip opening a PR.
- Skip opening a PR → does **not** imply skipping committing or pushing.

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

**Read the relevant skill(s) before starting related work** so accumulated
gotchas surface proactively instead of being rediscovered.

When you hit and resolve a setback or **non-obvious** problem — at *any* stage,
including the commit → push → PR → deploy wrap-up, not just while writing feature
code — record the insight **before moving on**:

1. **Framework / library-related** → update that framework's existing skill with
   the insight / gotcha.
2. **Anything else** — a service quirk, an integration, a config interaction, a
   piece of functionality, **or a developer-tooling / CLI / workflow gotcha**
   (`git`, `gh`, `vercel`, `wrangler`, `supabase`, `psql`, husky, a CI step) →
   find the existing skill for that area of concern and update it; **if none
   exists, create a new skill** for that concern.

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


