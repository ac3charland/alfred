# Postmortem: production Postgres password committed to the public repo

**Status:** password reset 2026-09-27; follow-up in the [Remediation guide](#remediation-guide) ·
**Severity:** high: full read/write credential to the owner's live database, public for ~96
days · **Format:** blameless

## Summary

On 2026-06-23 a local Claude Code session applying the ALF-35 Phase A migration recorded three
`psql` commands into a demo doc, `docs/demos/alf-35-phase-a/phase-a.md` (lines 12, 23, 34). Each
command carried the full Supabase session-pooler connection string for the `postgres` role of
project `pobfpuohktigmnkcqwga`, **password included**. PR #123 merged it 22 minutes after opening,
with no review. The repository is public, so the password has been readable by anyone since then.

Nobody inside the project noticed. On 2026-09-27 a third-party scanner (BreachSignal) emailed the
owner. Its email cited commit `0c8e433e` (PR #364), but that was only the newest commit it had
scanned. `0c8e433e` added one HTML spec and is unrelated. The leak originates in `2a32023e`.

A scan of the full git history (all 2,400+ commits, all branches) found **no other leaked
secret**. Every other hit is a placeholder such as `sb_secret_placeholder` or `:<password>@`.

## Impact

- **What was exposed:** the password of the `postgres` role. On Supabase this role owns the
  `public` schema. It can read and write every row, change schema, grants and RLS policies, and
  create roles, functions and triggers. Through the session pooler it works from any IPv4 address.
- **Exposure window:** from the push at ~15:00 CDT on 2026-06-23 until rotation on 2026-09-27,
  **~96 days**, assuming the repo was public for that whole period (not verified; see Open questions).
- **Evidence of misuse:** **unknown.** Supabase keeps connection logs for days, not months, so the
  logs can neither confirm nor rule out use. Also, the nightly backup workflow runs `pg_dump` as
  `postgres`, so a full copy taken by an attacker would look like our own backups in query
  statistics. The integrity audit in Appendix A is the only way to look for lasting damage.
- **What was not exposed:** the `service_role` and `anon` API keys, the Anthropic, GitHub and R2
  credentials, and `.env.local` itself (it is gitignored and was never committed).

## Timeline (CDT)

| When | What |
| --- | --- |
| 2026-06-09 | Repo created (public today; when it became public is unconfirmed). |
| 06-22 14:30 | **ALF-41**, a local session with live database credentials, records its live-database evidence as a **note** (quoted text), from a one-off `pg` client that **masks the password** (`…:****@…`). The safe pattern exists but is never written into a skill. |
| 06-23 13:42 | The ALF-35 spec prescribes a "supervised, credentialed" Phase A, run locally "exactly as ALF-41 §1 did". |
| 06-23 14:55–14:59 | A local Claude Code session (commits carry `-0500`; cloud sessions carry `+0000`) commits the migration, type regen, and **`2a32023e`**: the demo doc with three `exec` blocks that put the full URI in the command itself. |
| 06-23 15:00 | PR #123 opened. Its description links the demo doc, and the password is in that doc's first code block. |
| 06-23 15:00–15:06 | CI `check-fast` and `check-slow` pass. No check looks for secrets. |
| 06-23 15:22 | **Merged by the owner: 0 reviews, 0 comments.** About 14 PRs merged that day. |
| 07-28, 08-07 | New tooling means routine migrations no longer need a live credential in an agent session: `npm run describe` inspects the schema without credentials, and a CI workflow applies migrations on merge using GitHub secrets. Nobody notices the existing leak, and the cloud environment keeps injecting the credential into every session anyway (factor 8). |
| 06-23 → 09-27 | The file stays on `main`; 51 remote branches and every later PR ref contain it. GitHub raised no alert. |
| 09-27 15:00 | BreachSignal emails the owner, citing `0c8e433e`. |
| 09-27 | Leak confirmed, full history scanned (no other secrets), **database password reset**. |

## How it happened

Some background. **showboat** is the repo's demo-doc tool (`npm run demo`). Its `exec` command
runs a shell command and writes **both the command and its output** into the doc. Its `verify`
command re-runs every `exec` block later to prove the doc still reproduces.

The Phase A session had the production connection string in `frontend/.env.local`, as the
spec's "credentialed" step intended. It needed query results as evidence, and the showboat
skill at the time was explicit: *"a migration … uses CLI/`exec` output as its evidence: … the
query result."*

`psql` needs the connection string on its command line or in an exported environment variable.
`.env.local` is not exported, and the repo had no helper for ad-hoc live queries. The path of
least resistance was to paste the literal URI into the command. showboat recorded the command
exactly as written.

The session did not ignore the house rules; **it followed them.** The demo guidance pushed
toward a runnable, reproducible command. Nothing pushed back against putting a credential in it.

## Contributing factors

1. **The demo rules rewarded inlining.** They required `exec` evidence for migrations and a
   reproducible `verify`, but said nothing about credentials. A command that pastes the credential
   in is the most "self-contained" and reproducible form.
2. **No safe way to run a live query.** Nothing like `npm run psql` existed to resolve the URL
   from `.env.local` internally. `database/src/migrate.ts` has since added `resolveDatabaseUrl`,
   but only the deploy tool uses it.
3. **The safe precedent was never written down.** ALF-41's masked note, recorded the day before,
   was improvised. The ALF-35 spec copied ALF-41's workflow but not its redaction.
4. **Nothing scans for secrets.** Not the pre-commit hook, not CI, not GitHub (the repo has no
   GitHub Advanced Security, and no GitHub alert arrived in 96 days). Twelve commits on `main`
   were made through GitHub's web UI or API, which never runs local hooks at all.
5. **Review was not a security control.** At about 14 merges a day, a 22-minute merge with no
   review is the norm, not a lapse. The password sat in the first code block of the doc the PR
   linked. Human review cannot be the layer that catches this.
6. **The credential was more powerful than the job needed.** The demo's queries only read
   `information_schema` and counted rows, but ran as `postgres`. No read-only role exists.
7. **Nothing tells agents the repo is public.** Neither `CLAUDE.md` nor any skill says so. An
   agent deciding whether a file is safe to commit has no reason to picture it being published.
8. **The cloud environment puts production credentials in reach of every session.** The Claude
   Code cloud environment injects `DATABASE_URL`, which held this same leaked `postgres` URI.
   **No cloud session can even use it:** the sandbox blocks port 5432, and the `supabase` skill
   documents that `psql` times out. So it adds exposure and nothing else. Beside it sits
   `SUPABASE_ACCESS_TOKEN`, a Supabase personal access token. Through the Management API that
   token can run any SQL, reset the database password and read API keys, so it is more powerful
   than the password that leaked.

## What went well / where we got lucky

- `.gitignore` covered every `.env*` file, so the env file itself never leaked.
- The ALF-41 client masked the password; the pattern existed and needs codifying, not inventing.
- The migrate-on-merge workflow (August) removed the *need* for an agent to hold the production
  password. It did not remove the credential from the cloud environment (factor 8).
- No app table stores a credential, and the API keys use the new `sb_publishable_` / `sb_secret_`
  format, which is not stored in the database. Reading the database therefore yields data, not
  further keys (legacy JWT caveat in B2 below).
- **Lucky:** only the database password leaked, not the `service_role` key or an API key. And the
  finder was a disclosure service, not only an attacker.

## The model question

**Which model wrote `2a32023e` cannot be determined from the repo.** commitlint's `body-empty`
and `footer-empty` rules make a `Co-Authored-By` trailer impossible. PR #123 says only "Generated
with Claude Code". The session ran locally, so unlike today's cloud PRs it has no `claude.ai`
session link to look up. The transcript, if it still exists, is on the machine that ran it under
`~/.claude/projects/`; search the `.jsonl` files for `0005_story_priority`. Each assistant line
records a `model` field.

Knowing the model changes little. The failure is a general one for coding agents: follow the
explicit instruction ("reproducible exec evidence") using a credential within reach, with no
sense of who will read the result. It was a lapse of judgment an experienced engineer would
likely not make, and that is exactly why the fix cannot depend on judgment. A stronger model
lowers the odds; a gate removes them.

## Decisions

- **No history rewrite.** Once the password is rotated, the leaked value is useless. A rewrite
  would not remove it: GitHub keeps every `refs/pull/*/head` (only GitHub Support can purge
  those), 51 remote branches contain it, and scanners already have copies. It would also cost a
  force-push of about 2,400 commits and break every open branch. Rotation is the fix.
- **No reply to BreachSignal needed.** The finding was verified independently.

## Remediation guide

The reset made the leaked value useless everywhere at once. It also broke everything that
legitimately held the old value. **Part A** restores those, **Part B** closes what a password
reset cannot, and **Part C** proves both.

### Part A — Update everything that held the old password

Use the **session pooler** URI on port 5432. Not the direct connection (IPv6-only, so GitHub's
IPv4 runners can't reach it), and not the transaction pooler on port 6543 (`pg_dump` can't use it):

```
postgresql://postgres.pobfpuohktigmnkcqwga:<password>@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

If the password contains `@ : / ? # %`, percent-encode them, or let Supabase generate an
alphanumeric one.

| # | Where it lives | What reads it | Action | Broken until done |
| --- | --- | --- | --- | --- |
| A1 | GitHub → repo **Settings → Secrets and variables → Actions** → `SUPABASE_DB_URL_PERSONAL` | `backup.yml` (nightly `pg_dump` to R2 at 08:17 UTC) and `migrate.yml` (applies migrations on every push to `main`) | **Update** with the new URI | **Tonight's personal backup**, and the next merge that carries a migration |
| A2 | Your Mac: `frontend/.env.local` → `DATABASE_URL` | `npm run deploy -w database -- --dry-run` (via `resolveDatabaseUrl`) | **Update**, or point it at the read-only role once R7 lands | Local dry runs |
| A3 | Claude Code cloud environment → env var `DATABASE_URL` | **Nothing that works.** Cloud sandboxes cannot reach port 5432; confirmed on 09-27 (`pg_isready` got no response). | **Delete it; don't update it.** Cloud environment menu in a session's title bar → **Edit**. If agents need the project ref, add a non-secret `SUPABASE_PROJECT_REF`. New sessions pick up the change; running sessions keep the old value. | Nothing |
| A4 | Other copies on your Mac | Shell history (the June `psql` commands), `~/.pgpass`, GUI database clients, `supabase link` (stores the password for `supabase db …` runs without `--db-url`), the June Claude Code transcript | Update the clients you still use; the rest now hold a useless value, so clear them or leave them | Whatever you use them for |

**Checked and not affected:**

- **Vercel (frontend at runtime).** It reads only the Supabase URL, the publishable key and the
  secret key, never a database URL. If the Vercel–Supabase integration was ever installed, it may
  have copied `POSTGRES_*` variables into the Vercel project. alfred doesn't read them, so delete them.
- **Cloudflare Workers.** They use Supabase REST with the secret key; `wrangler.toml` has no Postgres binding.
- **Mac daemon.** No database URL.
- **Work instance** (`SUPABASE_DB_URL_WORK`). A separate project with its own password. If you
  reused the same password there, rotate it too.
- **API keys** (`sb_publishable_…`, `sb_secret_…`). They are not stored in the database and a
  password reset doesn't change them. No rotation needed (see B2 for the legacy JWT case).

### Part B — Close what a password reset doesn't

- **B1. Drop connections opened with the old password.** Postgres checks the password only at
  login; changing it does not end existing sessions. Through the pooler you can't tell whose
  connection is whose, so the clean fix is **Project Settings → General → Restart project**
  (about a minute of downtime).
- **B2. Check for a readable legacy JWT secret.** Run
  `select current_setting('app.settings.jwt_secret', true) is not null as legacy_jwt_secret_readable;`.
  Older Supabase projects exposed the legacy JWT secret as this database setting. If the query
  returns `true`, anyone who read the database could mint `service_role` tokens, and those keep
  working after a password reset. alfred uses the new `sb_` keys, so **disable the legacy
  JWT-based API keys** in the dashboard's API keys settings. If something still needs
  `SUPABASE_SERVICE_ROLE_JWT`, rotate the legacy JWT secret instead and update that one consumer.
  If the query returns `false`, skip this step.
- **B3. Your alfred login.** alfred signs in with `signInWithPassword`, so your password's bcrypt
  hash in `auth.users` was readable. If that password is weak or used anywhere else, change it.
  To end every existing session, run
  `delete from auth.sessions where user_id = (select id from auth.users where email = '<you>');`
  in the SQL editor, then sign in again.
- **B4. Integrity audit.** Run [Appendix A](#appendix-a--integrity-audit-run-as-postgres-after-rotation).
  A reset doesn't undo anything an intruder left behind: a role, a `SECURITY DEFINER` function
  callable over RPC, or an RLS policy opened to `anon`. The `anon` key ships in the browser
  bundle, so such a policy would still expose data after the reset.
- **B5. Data exposure.** There is nothing to rotate here, but know what was readable: messages
  and contacts (`comm_*`), reader posts, habits, weekly plans, tasks and wiki pages. If any stored
  message held a secret that is still valid, such as recovery codes, treat it as exposed.

### Part C — Verify

- **C1. The old password is rejected.** On your Mac, run
  `psql '<old URI>' -c 'select 1'` and expect `password authentication failed`. A cloud sandbox
  can't run this check because it has no route to port 5432.
- **C2.** **Actions → Backup → Run workflow**: the `personal` job is green. This proves A1 and
  that `pg_dump` works over the new URI.
- **C3.** **Actions → Migrate Databases → Run workflow**: the `personal` job is green ("nothing
  pending" counts as a pass).
- **C4.** Locally, `npm run deploy -w database -- --dry-run` succeeds (proves A2).
- **C5.** In a new cloud session, `env | grep -c '^DATABASE_URL='` prints `0` (proves A3).

## Recommendations

Owners: **You** = the repo owner; **Claude** = an agent session, delivered as a PR.

| # | Priority | Action | Owner | Status |
| --- | --- | --- | --- | --- |
| R1 | P0 | Reset the database password, then work through Part A of the [Remediation guide](#remediation-guide): update the GitHub secret and `.env.local`, delete the cloud environment's `DATABASE_URL`. | You | Reset done; A1–A3 done; A4 open |
| R2 | P0 | Remediation guide Part B (drop old connections, legacy JWT check, your alfred login, integrity audit), then Part C. | You | Open |
| R3 | P1 | **Add a secret-scanning gate:** secretlint with `@secretlint/secretlint-rule-preset-recommend`, as an `npm run` script inside `check:fast`, scanning every tracked file. Because CI also runs `check:fast`, commits made through the web UI or API are covered too. Remove the password from `phase-a.md` in the same PR so `main` stays green. Tested against this repo (Appendix B). | Claude | Done (ALF-301) |
| R4 | P1 | **Stop the leak at record time:** make `showboat exec` refuse to record a command or output that matches a secret pattern, pointing the author to R5. This catches the problem before anything reaches disk, not just at commit. | Claude | Done (ALF-301) |
| R5 | P1 | **Make the safe path the easy path:** add `npm run psql -w database -- -c "<sql>"`, which resolves the URL with the existing `resolveDatabaseUrl`. Demo commands then contain no secret and still reproduce for anyone with `.env.local`. | Claude | Done (ALF-301) |
| R6 | P2 | **Two lines of guidance:** in the showboat skill, "live-DB evidence goes through `npm run psql`, never an inlined URI"; in `CLAUDE.md`, "This repo is public: everything committed is published." | Claude | Done (ALF-301) |
| R7 | P2 | **Least privilege:** a read-only role for local or agent inspection. Create it in a migration **without** a password, set the password by hand in the dashboard, and point `.env.local` at it. Keep the `postgres` password only in GitHub secrets. | You + Claude | Open |
| R8 | P3 | Turn on GitHub secret scanning and push protection (repo **Settings → Advanced Security**), plus non-provider patterns if the repo offers them. This is extra protection, not the main control; GitHub did not catch this leak. | You | Open |
| R9 | P3 | For locally run sessions, name the model in the PR description, since commit trailers are forbidden and there is no session link. | Claude | Done (ALF-301) |
| R10 | P2 | **Treat `SUPABASE_ACCESS_TOKEN` as the most sensitive value in the cloud environment** (factor 8). Keep it only if cloud sessions truly need Management API SQL. Otherwise delete it and add it to a single session when a task requires it. | You | Done 2026-09-29: removed from the cloud environment |

R3–R5 are the core: **R5 removes the incentive, R4 catches mistakes at the source, R3 is the
safety net.** R6 alone would repeat the mistake that caused this: relying on an agent to
remember a rule.

## Open questions

- When did the repo become public? If after 2026-06-23, the exposure window is shorter.
- Was the password rotated at any point between June and now? The scanner's redacted value matched
  the committed one, so probably not.
- Does the local Phase A transcript still exist (see the model question)?

## Appendix A — integrity audit (run as `postgres` after rotation)

Compare each result against what the migrations should produce. `npm run describe -w database --
<tables>` prints the columns, constraints, indexes and API-role grants that the committed
migrations build, with no live database needed.

```sql
-- Roles: anything not a Postgres/Supabase built-in is suspect.
select rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin from pg_roles
where rolname !~ '^(pg_|supabase|pgsodium)' and rolname not in
  ('postgres','authenticator','anon','authenticated','service_role','dashboard_user','pgbouncer')
order by 1;

-- Auth users: a single-user app should have only the owner.
select id, email, created_at, last_sign_in_at from auth.users order by created_at;

-- RLS policies and API-role grants: anything opening data to anon is the big one.
select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' order by 1, 2;
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3;

-- Functions, triggers, event triggers: compare with `create function` / `create trigger` in database/migrations/.
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 1;
select tgrelid::regclass, tgname from pg_trigger where not tgisinternal order by 1, 2;
select evtname, evtevent, evtfoid::regproc from pg_event_trigger;

-- Scheduled jobs, extensions, publications, foreign servers (ways to copy data out).
select jobid, schedule, username, command from cron.job;   -- errors if pg_cron is not installed: fine
select extname, extversion from pg_extension order by 1;
select pubname, schemaname, tablename from pg_publication_tables order by 1, 2, 3;
select srvname from pg_foreign_server;

-- Query history since the last stats reset: look for statements you don't recognise.
-- Caveat: the nightly backup's COPY statements are expected and look like an attacker's dump.
select s.calls, left(s.query, 140) as query from extensions.pg_stat_statements s
join pg_roles r on r.oid = s.userid where r.rolname = 'postgres' order by s.calls desc limit 200;
```

To check the data itself, restore the oldest monthly R2 dump into a scratch cluster (see
`database/README.md` → *Restoring from a backup*) and compare row counts, and spot-check rows,
against the live database.

## Appendix B — scanner validation (for R3)

Run over every tracked file with secretlint 13.0.6 and `preset-recommend`:

- **Detected:** all three leaked lines in `phase-a.md` (`@secretlint/secretlint-rule-database-connection-string`).
- **False positives:** two placeholder templates, `.claude/skills/supabase/SKILL.md:401` and
  `frontend/.env.example:30`. Both contain `:<password>@`, and both are cleared by one rule
  option: `"allows": ["/:<password>@/"]`.
- **Passes:** `npm run psql -w database -- -c "…"`, the form R5 and R6 steer toward. Raw `psql "$DATABASE_URL" -c "…"` also passes the scan but is not equivalent: psql receives the full URI, password included, on its argv (visible in `ps`), and the URL has to be exported into the shell.
- GitHub's own scanning API could not be tested: the repo has no Advanced Security.
