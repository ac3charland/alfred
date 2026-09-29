---
name: secret-scan
description: >
  Covers secret-scan, the secretlint gate over every committable file (first step of the global
  check:fast, so pre-commit and CI, plus a workflow on every push), and the shared
  /.secretlintrc.json that showboat's record-time guard also reads. Use when the scan fails, a
  placeholder or test fixture trips a rule, or adding a secret pattern. Trigger on:
  "secret-scan", "secretlint", "lint:secrets", "leaked secret", "credential in a commit",
  "found PostgreSQL connection string", ".secretlintrc", "refused to record", "SecretError",
  or editing tools/secret-scan. For gathering live-database demo evidence, see the showboat skill.
---

# secret-scan — keep secrets out of the public repo

## What it is and why

The repo is **public**: every pushed commit, on any branch, is published. `tools/secret-scan`
runs secretlint (`preset-recommend` plus patterns for Supabase keys/tokens, `PGPASSWORD=`, libpq
`password=`, and JWTs) in three scopes:

| Script | Scans | Runs in |
| --- | --- | --- |
| `npm run lint:secrets -w tools/secret-scan` | every committable file on disk (tracked, or untracked and not ignored) **and** the staged content of every added/modified path | first step of root `check:fast` (pre-commit, CI `check-fast`) |
| `npm run lint:secrets:branch -w tools/secret-scan` | every blob each commit in `<merge-base with origin/main>..HEAD` added | first step of root `check:slow` (pre-push, CI `check-slow`) |
| `… lint:secrets -w tools/secret-scan -- --range A..B` | the same, for an explicit range | `.github/workflows/secret-scan.yml` on every push, which also covers web-UI/API commits that skip the hooks |

Untracked files count because the `batch-commits` script runs the gate *before* `git add`. The
range scans exist because a secret added in one commit and removed in the next is still
published. Gitignored files (`.env.local`) are never scanned. Background:
[the 2026-09-27 postmortem](../../../docs/postmortems/2026-09-27-postgres-credential-leak.md).

`/.secretlintrc.json` is the one config. `tools/showboat/src/secrets.ts` loads it too, so the
commit gate and showboat's `exec`/`note`/`verify` refusal always agree.

## When it fires

- **A real secret** → take it out of the file. If it was ever pushed, it's leaked: tell the user
  it needs **rotating**.
- **A flagged commit on your own unmerged branch** (the branch scan, even for a fake value) →
  rewrite the branch so `main` never carries it: fold the fix into the offending commit and
  `git push --force-with-lease` (see the `git` skill). Rewriting `main` doesn't un-publish anything
  (GitHub keeps PR refs and scanners have copies), so there it's rotation only.
- **A placeholder** → rewrite it in a shape the rules already skip: `:<password>@`, `:****@`,
  `"$DATABASE_URL"`, `password=<password>`, `sb_secret_<key>`. Adding an `allows` entry or
  disabling a rule to get green is weakening the gate (CLAUDE.md hard rules) — file a lint
  suggestion instead.

## Test fixtures that must look like a secret

Only for a **fake** value in a test: assemble it at runtime so the **source text** stays clean
(the scan reads files, not values). Doing this with a value that works anywhere is a leak.

```ts
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.ref:${PASSWORD}@host:5432/postgres`; // `${…}` reads as a variable
```

A fixture that shells out must not hit a real host: the cloud sandbox blocks 5432, so `psql`
against the pooler **hangs** rather than fails. Use `echo`.

## Gotchas

- **Always pass `maskSecrets: true` to `createEngine`.** secretlint 13 documents it as the
  default, but the stylish formatter prints the raw secret unless it's set, and CI logs are public.
- **`secretlint-disable` comments are defused, not honoured.** secretlint obeys the directive
  anywhere in the content, and a preset sub-rule's `"disabled": true` is silently ignored, so the
  scanner rewrites `secretlint-disable`/`-enable` to an inert form before scanning.
- **`git ls-files` lists more than files.** Symlinks to directories and tracked files deleted
  from the working tree both appear; `committableFiles` keeps regular files only.
- **Blind spots:** binary and UTF-16 files are skipped; a Postgres URI whose password contains
  `/`, or `$` followed by a capital, reads as a template to the connection-string rule; Cloudflare
  and R2 credentials have no rule; merge commits' own resolutions aren't range-scanned.
