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
runs secretlint (`preset-recommend` plus Supabase secret-key / access-token patterns) over every
text file git could commit — tracked, or untracked and not ignored (the `batch-commits` script
runs the gate *before* `git add`, so a tracked-only scan would miss every new file). Gitignored
files (`.env.local`) are never scanned, and binaries are skipped. It runs first in the root
`check:fast` (pre-commit and CI's `check-fast`) and in `.github/workflows/secret-scan.yml` on
every push, which covers web-UI/API commits that skip the hooks. Background:
[the 2026-09-27 postmortem](../../../docs/postmortems/2026-09-27-postgres-credential-leak.md).

`/.secretlintrc.json` is the one config. `tools/showboat/src/secrets.ts` loads it too, so the
commit gate and showboat's `exec`/`note` refusal always agree.

```bash
npm run lint:secrets -w tools/secret-scan
```

## When it fires

- **A real secret** → take it out of the file. If it was ever pushed, it's leaked: tell the user
  it needs **rotating** (a history rewrite doesn't un-publish it — GitHub keeps PR refs, and
  scanners already have copies).
- **A placeholder** → rewrite it in a shape the rules already skip: `:<password>@`, `:****@`,
  `"$DATABASE_URL"`, `sb_secret_<key>`. Adding an `allows` entry or disabling a rule to get green
  is weakening the gate (CLAUDE.md hard rules) — file a lint suggestion instead.

## Test fixtures that must look like a secret

Assemble them at runtime so the **source text** stays clean — the scan reads files, not values:

```ts
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.ref:${PASSWORD}@host:5432/postgres`; // `${…}` reads as a variable
```

A fixture that shells out must not hit a real host: the cloud sandbox blocks 5432, so `psql`
against the pooler **hangs** rather than fails. Use `echo`.

## Gotchas

- **Always pass `maskSecrets: true` to `createEngine`.** secretlint 13 documents it as the
  default, but the stylish formatter prints the raw secret unless it's set, and CI logs are public.
- **`git ls-files` lists more than files.** Symlinks to directories and tracked files deleted
  from the working tree both appear; `committableFiles` keeps regular files only.
