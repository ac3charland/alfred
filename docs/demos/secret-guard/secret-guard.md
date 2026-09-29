---
branch: claude/alf-301-back-pressure-secrets-pch7c7
---

# ALF-301: keeping secrets out of the public repo

*2026-09-29T19:20:11.479Z*

The [credential-leak postmortem](../../postmortems/2026-09-27-postgres-credential-leak.md) traced a production Postgres password to a demo doc: showboat recorded a `psql` command with the full connection URI inlined, and nothing scanned for secrets. This branch adds three layers: a **commit gate** (R3), a **record-time guard** in showboat (R4), and a **safe path** for live queries (R5).

**Layer 1: the commit gate.** `secret-scan` runs secretlint over every tracked file as the first step of `check:fast` (pre-commit and CI). The real repo scans clean now that `phase-a.md` no longer carries the password:

```bash
npm run --silent lint:secrets -w tools/secret-scan | sed -E "s/[0-9]+ tracked/N tracked/"
```

```output
secret-scan: N tracked text file(s) clean.
```

The same gate on a scratch repo with the June leak reproduced in a staged file. It fails, and masks the secret in its report (CI logs are public too):

```bash
R=$PWD; T=$(mktemp -d); cd "$T" && git init -q && printf "psql %s%s@db.example.com:5432/postgres -c \"select 1\"\n" postgresql://postgres:Qz7vLk2 Rw9pT > leak.md && git add leak.md; node "$R/tools/secret-scan/src/cli.ts" > out 2>&1; code=$?; sed "s#$T/##" out; echo "exit=$code"; cd "$R"; rm -rf "$T"
```

```output

leak.md
  1:5  error  [PostgreSQLConnection] found PostgreSQL connection string: ***************************************************************  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-database-connection-string

✖ 1 problem (1 error, 0 warnings, 0 infos)

secret-scan: a secret is in a tracked file. This repo is PUBLIC — everything committed or pushed
is published. Remove it from the file (and `git rm --cached` it if the whole file is a secret);
if it was ever pushed, treat it as leaked and rotate it. For live-database evidence use
`npm run psql -w database -- -c "<sql>"`, which reads the URL from frontend/.env.local.
A placeholder that trips a rule: write it as <password>, **** or "$VAR" — never weaken
/.secretlintrc.json to get green (see the secret-scan skill).
exit=1
```

**Layer 2: showboat refuses to record a secret.** `exec` checks the command before running it and the output before recording it; `note` checks its text. Both read the same `/.secretlintrc.json` as the gate. Here the June command is replayed into a scratch doc (the password sits in a shell variable, so this outer block records no secret), then a command whose *output* carries one:

```bash
S=/tmp/secret-guard-scratch.md; P=Qz7vLk2; npm run --silent demo -- init $S Scratch --branch x; npm run --silent demo -- exec $S bash "psql 'postgresql://postgres.ref:${P}Rw9pT@aws-1-us-east-2.pooler.supabase.com:5432/postgres' -c 'select 1'" 2>&1; echo "exit=$?"; echo; npm run --silent demo -- exec $S bash "printf '%s%s@db.example.com/postgres\n' postgresql://postgres:$P Rw9pT" 2>&1; echo "exit=$?"; echo; echo "entries recorded: $(grep -c "^\`\`\`bash" $S)"; rm $S
```

```output
showboat: refused to record command in /tmp/secret-guard-scratch.md: it looks like a secret, and this repo is public.
<command>
  1:6  error  [PostgreSQLConnection] found PostgreSQL connection string: *****************************************************************************************  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-database-connection-string

✖ 1 problem (1 error, 0 warnings, 0 infos)
Nothing was written. For live-database evidence run `npm run psql -w database -- -c "<sql>"`, which reads the URL from frontend/.env.local; otherwise keep the value in an env var (`"$NAME"`) or mask it (`:****@`).
exit=1

showboat: refused to record command output in /tmp/secret-guard-scratch.md: it looks like a secret, and this repo is public.
<command output>
  1:0  error  [PostgreSQLConnection] found PostgreSQL connection string: **********************************************************  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-database-connection-string

✖ 1 problem (1 error, 0 warnings, 0 infos)
Nothing was written. For live-database evidence run `npm run psql -w database -- -c "<sql>"`, which reads the URL from frontend/.env.local; otherwise keep the value in an env var (`"$NAME"`) or mask it (`:****@`).
exit=1

entries recorded: 0
```

**Layer 3: the safe path.** `npm run psql -w database -- <psql args>` resolves `DATABASE_URL` (exported, else from the gitignored `frontend/.env.local`) and passes the password to `psql` as `PGPASSWORD`, so it is never in the command and never on `psql`'s argv. [`live-db.sh`](live-db.sh) starts a throwaway Postgres that requires a scram-sha-256 password, sets `DATABASE_URL` with a random one, and calls the wrapper:

```bash
docs/demos/secret-guard/live-db.sh -w -At -c "select 'authenticated as ' || current_user" </dev/null 2>&1
```

```output
authenticated as postgres
```

With the password left out of the URL, the same server refuses the connection, which shows the wrapper really did supply it above:

```bash
NO_PASSWORD=1 docs/demos/secret-guard/live-db.sh -w -At -c "select 1" </dev/null 2>&1; echo "exit=$?"
```

```output
psql: error: connection to server at "127.0.0.1", port 54329 failed: fe_sendauth: no password supplied
exit=2
```

This is now the recorded form in the June demo, whose three `psql` blocks had the password inlined:

```bash
grep -o "^psql \"\$DATABASE_URL\" -c" docs/demos/alf-35-phase-a/phase-a.md
```

```output
psql "$DATABASE_URL" -c
psql "$DATABASE_URL" -c
psql "$DATABASE_URL" -c
```

Commits made through the GitHub web UI or API skip the local hooks, and CI's `check-fast` runs only on pull requests. `.github/workflows/secret-scan.yml` runs the same scan on every push to any branch. The guidance side: `CLAUDE.md` now states the repo is public, and the new `secret-scan` skill plus the showboat and supabase skills point live-DB evidence to `npm run psql`.
