# Alfred

A single-user, **capture-first** personal task system — TypeScript end to end.
See [`docs/specs/product/SPEC.md`](docs/specs/product/SPEC.md) for the full design and [`CLAUDE.md`](CLAUDE.md)
for the agent operating rules.

## Monorepo layout (npm workspaces)

- `frontend/` — Next.js (App Router) app → Vercel.
- `workers/` — Cloudflare Workers (future LLM processing layer; scaffolded only).
- `database/` — Supabase schema, migrations, and dev seed.
- `docs/` - Various written documentation and context.
  - `docs/specs/` - Specs for implementing changes to alfred.

One repo, one root `package.json`, one lockfile. The root `check` / `check:fast` /
`check:slow` scripts fan out to every workspace.

## Prerequisites

- Node **24** (`.nvmrc`)
- A Supabase project
- (To deploy) a Vercel account

## First-time setup

> **Want to automate most of this?** Hand
> [`docs/finish-setup-agent-prompt.md`](docs/finish-setup-agent-prompt.md) to a Claude Code
> agent running on a normal (un-firewalled) machine — it applies the schema, regenerates
> types, verifies/creates the auth user, runs live end-to-end smoke tests, and deploys to
> Vercel, asking you only for secrets and the iPhone-only Siri step.

### 1. Install

```bash
nvm use        # Node 24
npm install    # installs all workspaces into the single root node_modules
```

### 2. Environment variables

```bash
cp frontend/.env.example frontend/.env.local
```

Fill in `frontend/.env.local` (Supabase → Project Settings):

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API → Project URL | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API → `sb_publishable_…` key | public, client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | API → `sb_secret_…` key | **server-only**, bypasses RLS |
| `INGEST_API_KEY` | generate: `openssl rand -hex 32` | server-only; the Siri ingress secret |
| `DATABASE_URL` | Database → Connection string → **Direct connection** (URI) | migrations and ad-hoc `psql` only |

`.env.local` is gitignored — never commit real secrets.

Optional — the Code Dashboard's rolling seven-day PR-ratio card (`GET /api/code/pr-ratio`)
and lines-changed chart (`GET /api/code/loc-velocity`). The measured repos are the Code
module's **projects** — every project's repo, oldest project first, each labelled and coloured
as that project is everywhere else — so there is no repo list to configure. Leave the token
unset and both endpoints answer 501 and neither card renders; the Dashboard is otherwise
unaffected. The ratio needs at least two projects, the chart one:

| Var | Where | Notes |
|---|---|---|
| `GITHUB_TOKEN` | GitHub → fine-grained PAT | **server-only**; needs Pull requests: read (+ Metadata: read) on **every project's repo**. One it can't read fails the whole measurement, so both cards show their error note until the PAT's repository list is widened — add a new project's repo to the PAT when you create the project |
| `PR_RATIO_AUTHORS` | `login,login` | optional allowlist of GitHub logins whose merged PRs count; unset excludes the known dependency bots instead. **Also switches on the "Other" segment** — those logins' merged PRs in every repo that is not a project's. Without it there is nothing to anchor that search on, so the bar shows only the projects |

### 3. Apply the database schema

Migrations are applied by CI on every merge to `main`
([`database/README.md`](database/README.md#applying-on-merge-the-default-path)). To set up a new
(empty) project from your machine, run the same applier — it applies every migration in order
(the **Direct connection** is IPv6 and works from a normal network):

```bash
npm run deploy -w database
```

Optional dev seed (two folders + a 3-level subtask tree). `psql` goes through the wrapper, which
reads `DATABASE_URL` from `frontend/.env.local` and passes the password as `PGPASSWORD`, so it
never appears on the command line. `npm run … -w database` runs with `database/` as the working
directory, hence the path is relative to it:

```bash
npm run psql -w database -- -f seed.sql
```

No `psql`? Any Postgres client works, or paste each file into the Supabase **SQL Editor**.
If your network is IPv4-only, use the **Session pooler** connection string instead
(host `aws-…pooler.supabase.com`, port 5432) — not the transaction pooler (6543).

### 4. Regenerate the schema types

```bash
npm run gen-types -w database
```

This rebuilds `frontend/lib/database.types.ts` from `database/migrations/` — it applies them to a
throwaway local cluster and describes the result, so it needs no live database and no Supabase
access token. Add `-- --check` to verify the committed file is current without rewriting it. See
[`database/README.md`](database/README.md#regenerating-frontendlibdatabasetypests).

### 5. Create your login user

Alfred is single-user with **no sign-up flow**. In Supabase →
**Authentication → Users → Add user**, create your account (email + password, with
**Auto Confirm User** enabled). That account is how you log in.

### 6. Run

```bash
npm run dev -w frontend   # http://localhost:3000
```

## Checks (back-pressure)

| Command | Runs | Gates |
|---|---|---|
| `npm run check:fast` | type-check → lint+format → unit tests | commits (pre-commit hook) |
| `npm run check:slow` | Storybook snapshots + Playwright E2E | pushes (pre-push hook) |
| `npm run check` | both | manual / CI |

Failures are fixed in the **code**, never by weakening config or bypassing hooks
(see `CLAUDE.md`).

> **Browser for E2E/Storybook:** these use Playwright's managed Chromium, installed by
> the test scripts via `setup:chromium` (which skips the download when the browser is
> already present). On a normal machine this just works. In Claude Code on the web the
> default sandbox blocks Playwright's browser CDN, so they run in the dedicated `alfred-e2e`
> cloud environment that allowlists it — see [`docs/cloud-environment.md`](docs/cloud-environment.md).

## Deploy (Vercel)

- Import the repo; set the **root directory** to `frontend/`.
- Add the same env vars under **Settings → Environment Variables** (`NEXT_PUBLIC_*`
  are build-time and browser-exposed; `SUPABASE_SERVICE_ROLE_KEY` and `INGEST_API_KEY`
  are server-only — do **not** prefix them `NEXT_PUBLIC_`).
- Push to deploy.
