# Alfred

A single-user, **capture-first** personal task system — TypeScript end to end.
See [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`CLAUDE.md`](CLAUDE.md)
for the agent operating rules.

## Monorepo layout (npm workspaces)

- `frontend/` — Next.js (App Router) app → Vercel.
- `workers/` — Cloudflare Workers (future LLM processing layer; scaffolded only).
- `database/` — Supabase schema, migrations, and dev seed.

One repo, one root `package.json`, one lockfile. The root `check` / `check:fast` /
`check:slow` scripts fan out to every workspace.

## Prerequisites

- Node **24** (`.nvmrc`)
- A Supabase project
- (To deploy) a Vercel account

## First-time setup

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
| `DATABASE_URL` | Database → Connection string → **Direct connection** (URI) | migrations/types only |

`.env.local` is gitignored — never commit real secrets.

### 3. Apply the database schema

From your machine (the **Direct connection** is IPv6 and works from a normal network):

```bash
# Schema: enums, items/folders, recursive functions, RLS policies
psql "$DATABASE_URL" -f database/migrations/0001_initial_schema.sql

# Optional dev seed (two folders + a 3-level subtask tree)
psql "$DATABASE_URL" -f database/seed.sql
```

No `psql`? Any Postgres client works, or paste each file into the Supabase **SQL Editor**.
If your network is IPv4-only, use the **Session pooler** connection string instead
(host `aws-…pooler.supabase.com`, port 5432) — not the transaction pooler (6543).

### 4. Regenerate the schema types

```bash
npx supabase gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```

The committed `frontend/lib/database.types.ts` is hand-authored to match
`database/migrations/0001_initial_schema.sql`; regenerating confirms it against the
live DB. `--db-url` needs no Supabase access token.

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

> **Browser for E2E/Storybook:** on a normal machine these use Playwright's managed
> Chromium (`npx playwright install chromium`, run automatically by the test scripts).
> A `@sparticuz/chromium` fallback exists only for CDN-restricted sandboxes and is
> inert (never used) when `/tmp/chromium` is absent.

## Deploy (Vercel)

- Import the repo; set the **root directory** to `frontend/`.
- Add the same env vars under **Settings → Environment Variables** (`NEXT_PUBLIC_*`
  are build-time and browser-exposed; `SUPABASE_SERVICE_ROLE_KEY` and `INGEST_API_KEY`
  are server-only — do **not** prefix them `NEXT_PUBLIC_`).
- Push to deploy.
