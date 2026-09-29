---
branch: claude/alf-301-back-pressure-secrets-pch7c7
---

# ALF-301: keeping secrets out of the public repo

*2026-09-29T19:45:39.062Z*

The [credential-leak postmortem](../../postmortems/2026-09-27-postgres-credential-leak.md) traced a production Postgres password to a demo doc: showboat recorded a `psql` command with the full connection URI inlined, and nothing scanned for secrets. This branch adds three layers: **commit and push gates** (R3), a **record-time guard** in showboat (R4), and a **safe path** for live queries (R5).

**Layer 1a: the commit gate.** `npm run lint:secrets -w tools/secret-scan`, the first step of `check:fast` (pre-commit and CI), scans every committable file (tracked, or untracked and not gitignored) plus the staged content of every changed path. The real repo scans clean now that `phase-a.md` no longer carries the password:

```bash
npm run --silent lint:secrets -w tools/secret-scan | sed -E "s/[0-9]+ text/N text/"
```

```output
secret-scan: clean (N text entries scanned).
```

The same gate on a scratch repo. `leak.md` reproduces the June URI in a new, never-staged file. `env.md` holds the `PGPASSWORD=` form an agent might switch to, behind a `secretlint-disable` comment that would normally silence secretlint. Both are caught, and the report masks the secrets (CI logs are public too):

```bash
R=$PWD; T=$(mktemp -d); cd "$T" && git init -q && printf "psql %s%s@db.example.com:5432/postgres -c \"select 1\"\n" postgresql://postgres:Qz7vLk2 Rw9pT > leak.md && printf "<!-- secretlint-%s -->\nexport PG%s=%s%s\n" disable PASSWORD Qz7vLk2 Rw9pT > env.md; node "$R/tools/secret-scan/src/cli.ts" > out 2>&1; code=$?; sed "s#$T/##" out; echo "exit=$code"; cd "$R"; rm -rf "$T"
```

```output

env.md
  2:7  error  [PATTERN] found matching *******************************: ***********************  @secretlint/secretlint-rule-pattern

✖ 1 problem (1 error, 0 warnings, 0 infos)


leak.md
  1:5  error  [PostgreSQLConnection] found PostgreSQL connection string: ***************************************************************  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-database-connection-string

✖ 1 problem (1 error, 0 warnings, 0 infos)


secret-scan: a secret would be committed or published. This repo is PUBLIC — everything committed
or pushed is published. Remove it from the file (and `git rm --cached` it if the whole file is a
secret); if it was ever pushed, treat it as leaked and rotate it. A flagged commit on your own
unmerged branch also needs the branch rewritten (fixup + force-push) so main never carries it.
For live-database evidence use `npm run psql -w database -- -c "<sql>"`, which reads the URL
from frontend/.env.local. A placeholder that trips a rule: write it as <password>, **** or
"$VAR" — never weaken /.secretlintrc.json to get green (see the secret-scan skill).
exit=1
```

**Layer 1b: the push gates.** A secret committed and then removed is still published once the branch is pushed. `npm run lint:secrets:branch -w tools/secret-scan`, the first step of `check:slow` (pre-push and CI), scans every blob each commit since `origin/main` added. The push workflow runs the same scan over the pushed range. Here a scratch branch adds the June URI in one commit and scrubs it in the next: the tip is clean, but the branch is not:

```bash
R=$PWD; T=$(mktemp -d); cd "$T" && git init -q && c() { git add -A && git -c user.name=d -c user.email=d@d commit -qm "$1"; }; echo base > a.md && c base && git update-ref refs/remotes/origin/main HEAD && printf "%s%s@db.example.com/postgres\n" postgresql://postgres:Qz7vLk2 Rw9pT > a.md && c leak && echo scrubbed > a.md && c scrub; node "$R/tools/secret-scan/src/cli.ts" 2>&1 | sed -E "s/[0-9]+ text/N text/"; node "$R/tools/secret-scan/src/cli.ts" --branch > out 2>&1; code=$?; sed -E "s/^[0-9a-f]{12}:/<leak commit>:/" out | head -4; echo "exit=$code"; cd "$R"; rm -rf "$T"
```

```output
secret-scan: clean (N text entries scanned).

<leak commit>:a.md
  1:0  error  [PostgreSQLConnection] found PostgreSQL connection string: **********************************************************  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-database-connection-string

exit=1
```

**Layer 2: showboat refuses to record a secret.** `exec` checks the command before running it and the output before recording it. `note` checks its text, and `verify` never writes or echoes a fresh output that carries one. All of them read the same `/.secretlintrc.json` as the gates. Here the June command is replayed into a scratch doc (the password sits in a shell variable, so this outer block records no secret), then a command whose *output* carries one:

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

The guidance side: `CLAUDE.md` now states the repo is public, and the new `secret-scan` skill plus the showboat and supabase skills point live-DB evidence to `npm run psql`.
