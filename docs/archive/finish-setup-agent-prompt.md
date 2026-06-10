# Finish-setup agent prompt (run outside the sandbox)

This is a **prompt for a Claude Code agent running on a normal machine** (full network
access — can reach Supabase, Vercel, npm, GitHub). It picks up where the build sandbox left
off: the alfred MVP code is complete and merged, but the live project (DB schema, auth user,
deployment) isn't provisioned yet, because the build environment had no route to Supabase.

**How to use:** open Claude Code in this repo on a machine with normal internet, and paste
everything in the `─── PROMPT ───` block below (or just say: "Read and execute
`docs/finish-setup-agent-prompt.md`").

---

## ─── PROMPT ───

You are finishing the deployment/provisioning of **alfred** (a single-user, capture-first
task app — see `README.md` and `docs/SPEC.md`). The application code is done and green; your
job is to make it **live and verified**. You have full network access. Automate every step
you can; stop and ask the human ONLY for secrets/credentials you can't generate, for the one
iPhone-only step, and whenever a verification fails.

### Operating rules
- **Never commit secrets.** `frontend/.env.local` is gitignored — keep real values only
  there (and in Vercel's encrypted env). Never print a full secret into a file that gets
  committed. Don't `git add` `.env.local`.
- Work on a branch; commit the things that SHOULD be tracked (a regenerated
  `frontend/lib/database.types.ts`, an optional `vercel.json`, an optional auth-verification
  Playwright test). The repo's husky hooks gate commits/pushes — fix failures in code, never
  with `--no-verify` (see `CLAUDE.md`).
- After each step, **verify it worked** before moving on. Report a concise status at the end.
- Be idempotent where you can; check current state before acting (e.g. don't re-run the
  migration on an already-provisioned DB).

### Step 0 — Orient & install
1. `node --version` — need Node 24 (`nvm use` if needed; `.nvmrc` pins it).
2. From the repo root: `npm install`.
3. `npm run check` — confirm the whole suite is green on this machine first. (Playwright will
   use its standard managed Chromium here via `npx playwright install`; the `@sparticuz`
   fallback is inert when `<tmpdir>/chromium` is absent.) If `playwright install` is needed,
   run it.

### Step 1 — Collect secrets → `frontend/.env.local`
If `frontend/.env.local` already exists and is populated, use it. Otherwise
`cp frontend/.env.example frontend/.env.local` and ask the human for the values below
(point them at Supabase → **Project Settings**):
- `NEXT_PUBLIC_SUPABASE_URL` — Project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the **publishable** key (`sb_publishable_…`).
- `SUPABASE_SERVICE_ROLE_KEY` — the **secret** key (`sb_secret_…`). Server-only.
- `INGEST_API_KEY` — generate it yourself: `openssl rand -hex 32`. (Reuse the existing one if
  the app was already deployed.)
- `DATABASE_URL` — the **Direct connection** URI (Database → Connection string → Direct).
  Works from a normal network (IPv6). **Gotchas:** wrap the value in quotes, and if the
  password has special chars, percent-encode them (`#` → `%23`, `@` → `%40`, etc.), or pass
  the password as a separate field when connecting.

Verify connectivity before proceeding, e.g.:
```bash
# expects the loaded DATABASE_URL; psql, or a quick node 'pg' script, or `npx supabase`
psql "$DATABASE_URL" -c 'select 1;'
```
If `psql` isn't installed, install it (`brew install libpq` / `apt-get install postgresql-client`)
or write a one-off Node script using the already-installed `pg`-less stack — simplest is to
`npm i -g supabase` or use `npx supabase`.

### Step 2 — Apply the schema (FIRST TIME on a fresh project)
The migration uses `create type` / `create table`, so it's meant to run **once** on an empty
public schema. Check first: `psql "$DATABASE_URL" -c "\dt"`. If `items`/`folders` already
exist, the schema was already applied — skip to Step 3 (don't re-run, it'll error on
duplicate types). On a fresh project:
```bash
psql "$DATABASE_URL" -f database/migrations/0001_initial_schema.sql
psql "$DATABASE_URL" -f database/seed.sql        # optional dev data
```
Verify:
```bash
psql "$DATABASE_URL" -c "\dt"                       # items, folders
psql "$DATABASE_URL" -c "select count(*) from items;"   # seed rows if you ran seed.sql
psql "$DATABASE_URL" -c "\df get_subtree complete_subtree"  # functions exist
psql "$DATABASE_URL" -c "select relname, relrowsecurity from pg_class where relname in ('items','folders');"  # RLS = t
```

### Step 3 — Regenerate the schema types from the live DB
```bash
npx supabase gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```
`git diff frontend/lib/database.types.ts` — the committed file was hand-authored to match the
migration, so the diff should be small/cosmetic. Run `npm run check:fast -w frontend` to
confirm the app still type-checks against the generated types; fix any real mismatch in code
(there shouldn't be one). **Commit** the regenerated file.

### Step 4 — Ensure the single login user exists
The owner has likely **already created their user** in the Supabase dashboard — so CHECK
FIRST and skip creation if one exists. With the service-role key:
```js
// one-off, don't commit
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await admin.auth.admin.listUsers();
console.log(data.users.map((u) => `${u.email} (confirmed: ${Boolean(u.email_confirmed_at)})`));
```
If a user exists, confirm with the human it's the one they want to log in with, make sure it's
**confirmed** (if `email_confirmed_at` is null, you can confirm it via
`admin.auth.admin.updateUserById(id, { email_confirm: true })`), and move on to Step 5 to
verify sign-in actually works. Only if NO user exists: ask the human for the desired **email**
and **password**, then create it (no dashboard needed):
```js
const { data, error } = await admin.auth.admin.createUser({
  email: process.env.NEW_USER_EMAIL,
  password: process.env.NEW_USER_PASSWORD,
  email_confirm: true,            // so they can log in immediately
});
console.log(error ?? `created user ${data.user?.id}`);
```

### Step 5 — Real end-to-end verification (the sandbox could NOT do this)
Start the app and exercise the live paths:
```bash
npm run dev -w frontend &     # http://localhost:3000 ; wait for "Ready"
```
1. **Siri/ingress path** (the API-key capture): expect `201` and the created item:
   ```bash
   curl -sS -X POST http://localhost:3000/api/items \
     -H "x-api-key: $INGEST_API_KEY" -H 'content-type: application/json' \
     -d '{"text":"agent smoke test"}' | tee /dev/stderr | grep -q '"item_type":"unclassified"'
   ```
   Then confirm it landed: `psql "$DATABASE_URL" -c "select title from items where raw_capture='agent smoke test';"`.
2. **Auth required without a key:** `curl -i -X POST .../api/items -d '{"text":"x"}'` → expect `401`.
3. **Auth gate:** `curl -i http://localhost:3000/` → expect a redirect to `/login`; `GET /login` renders the form.
4. **Full suite against real types:** `npm run check` — green.
5. **(Stretch, recommended) UI auth flow E2E:** author a Playwright setup project that signs in
   with the created credentials (via the browser Supabase client) and saves `storageState`,
   then a test that captures a task in the UI and asserts it appears in the Inbox. This is the
   one flow no in-sandbox test could cover. If you add it, keep it in `frontend/e2e/`, make
   `check:slow` pass, and commit it. Clean up the smoke-test item afterward.

### Step 6 — Deploy to Vercel
Confirm with the human before deploying. Two paths — prefer the CLI if they give you a token:
- **CLI (automatable):** ask for a `VERCEL_TOKEN` (Vercel → Account → Tokens) or have them run
  `vercel login`. Then:
  ```bash
  npm i -g vercel    # or use npx vercel
  vercel link        # select/create the project; set Root Directory = frontend/
  # add env vars to production (and preview if desired):
  for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY INGEST_API_KEY; do
    vercel env add "$v" production   # paste the value from frontend/.env.local when prompted
  done
  vercel --prod
  ```
  (If `vercel link` can't set the root dir non-interactively, add a `vercel.json` with
  `{"rootDirectory":"frontend"}` or set it in the dashboard, and commit `vercel.json`.)
  **NOTE:** the `NEXT_PUBLIC_*` vars are build-time + browser-exposed; `SUPABASE_SERVICE_ROLE_KEY`
  and `INGEST_API_KEY` are **server-only** — never give them a `NEXT_PUBLIC_` name.
- **Dashboard (if they prefer):** instruct them to import the GitHub repo in Vercel, set Root
  Directory = `frontend/`, add the same env vars, and deploy. Give them the exact var list.

Verify the production deploy: load the URL (→ `/login`), and hit the ingress on the prod URL:
`curl -X POST https://<prod-url>/api/items -H "x-api-key: $INGEST_API_KEY" -H 'content-type: application/json' -d '{"text":"prod smoke"}'` → `201`. Then sign in at the URL with the created credentials and confirm the captured items show in the Inbox. Clean up smoke-test items.

### Step 7 — Siri Shortcut (iPhone-only — hand off to the human)
You can't build this (it's on their phone). Print the exact values they need and walk them
through `docs/siri-capture.md`:
- **Endpoint:** `https://<their-prod-url>/api/items`
- **Header:** `x-api-key: <their INGEST_API_KEY>` (read it from `frontend/.env.local`; show it
  to them privately — it's their secret).
- **Body:** JSON `{ "text": "<Dictated Text>" }`, with the ~2s Wait-before-Dictate mitigation.

### Final report
Summarize: schema applied? types regenerated+committed? auth user created? local + prod smoke
tests (paste the key results)? deployed URL? what (if anything) you still need from the human
(e.g. the Siri Shortcut, a Vercel token you didn't get). List any follow-ups you noticed.

## ─── END PROMPT ───
