---
name: secret-scan
description: >
  Covers secret-scan, the secretlint gate over files on disk and staged (first step of the global
  check:fast, so pre-commit and CI) and the commits a push carries (pre-push hook, check:slow, a
  workflow on every push), plus the shared /.secretlintrc.json that showboat's guard reads. Use
  when the scan fails, a placeholder or test fixture trips a rule, or adding a secret pattern.
  Trigger on:
  "secret-scan", "secretlint", "lint:secrets", "leaked secret", "credential in a commit",
  "found PostgreSQL connection string", ".secretlintrc", "refused to record", "SecretError",
  or editing tools/secret-scan. For live-database demo evidence, see the showboat skill.
---

# secret-scan — keep secrets out of the public repo

## What it is and why

The repo is **public**: every pushed commit, on any branch, is published. `tools/secret-scan`
runs secretlint (`preset-recommend` plus patterns for Supabase keys/tokens, `PGPASSWORD=`, libpq
`password=` incl. quoted/spaced, `DB_PASSWORD`-style env assignments, `supabase --password`, and
JWTs) in four scopes:

| Script | Scans | Runs in |
| --- | --- | --- |
| `npm run lint:secrets -w tools/secret-scan` | every committable file on disk (tracked, or untracked and not ignored) **and** the staged content of every added/modified/type-changed path | first step of root `check:fast` (pre-commit, CI `check-fast`) |
| `npm run lint:secrets:push -w tools/secret-scan -- <remote>` | every blob added by the commits being pushed that `<remote>` doesn't have, read from git's pre-push stdin, so pushing a branch that isn't checked out is covered | `.husky/pre-push`, before `check:slow` |
| `npm run lint:secrets:branch -w tools/secret-scan` | every blob each commit in `origin/main..HEAD` added; **exits 1 when there is no `origin/main`** | first step of root `check:slow` (pre-push, CI `check-slow`) |
| `… lint:secrets -w tools/secret-scan -- --range A..B` | the same, for an explicit range | `.github/workflows/secret-scan.yml` on every push, which also covers web-UI/API commits that skip the hooks |

Untracked files count because the `batch-commits` script runs the gate *before* `git add`. The
range scans exist because a secret added in one commit and removed in the next is still
published; they include merge commits' own resolutions (`git log -m`) and type changes.
Gitignored files (`.env.local`) are never scanned. Background:
[the 2026-09-27 postmortem](../../../docs/postmortems/2026-09-27-postgres-credential-leak.md).

`/.secretlintrc.json` is the one config. `tools/showboat/src/secrets.ts` loads it too, so the
commit gate and showboat's record-time refusal always agree.

**Live values, not just patterns.** Every scope (and showboat) also refuses content holding the
*actual value* of a credential it can see: env vars named like `PASS|SECRET|TOKEN|KEY|PWD`, the
password of any `*_URL`/`*_URI`/`*_DSN`, and the same keys in `frontend/.env.local` — raw,
URL-encoded, JSON-escaped, base64 and UTF-16. That catches the shapes no pattern can (a bare
`printenv`, a truncated URI). Trivial values (`postgres`, placeholders, <8 chars) are ignored, and a
report names only the variable. `known-secrets.ts` is duplicated in `tools/secret-scan` and
`tools/showboat` (the tools can't import each other's source); change both copies together.

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
- **`DEBUG=@secretlint/*` makes secretlint print every scanned file's raw content.** The `debug`
  module reads `DEBUG` once as it loads, so both scanners import `@secretlint/node` dynamically
  with `DEBUG` removed from `process.env` (restored right after, since showboat's `exec` children
  inherit it). Never import it statically.
- **Errors print `error.message` only.** A failed `execFileSync` carries git's `stdout` buffer —
  file content — so the CLI catches everything and never prints the error object.
- **`secretlint-disable` comments are defused, not honoured.** secretlint obeys the directive
  anywhere in the content, and a preset sub-rule's `"disabled": true` is silently ignored, so the
  scanner rewrites `secretlint-disable`/`-enable` to an inert form before scanning.
- **"Binary" means a known signature, not a NUL byte.** PNG/GIF/JPEG/WebP/WOFF/PDF/ZIP/gzip
  headers are skipped (the repo tracks ~1,100 PNGs); everything else is scanned with NULs turned
  into newlines, and UTF-16 with a BOM is decoded, so a stray NUL can't hide a text file.
- **Blobs are read by id, never by path.** `git show :<path>` mis-resolves a path like `0:foo` to
  stage 0 of `foo`; the staged and range scans take blob ids from `git diff --raw` /
  `git log --raw` and read them with `git cat-file --batch`. Gitlinks (mode 160000) are skipped.
- **The working-tree scan doesn't follow symlinks.** A symlink is scanned as its link text; a
  tracked symlink to a directory or a file deleted from disk is not read as a file.
- **The `*_PASSWORD` rule exempts only code:** after `:` a letters-only identifier followed by
  `, } ) ] ;` (`{ PGPASSWORD: password }`, `DB_PASSWORD: string;`), after `=` a member expression
  (`process.env.X`), and the literal `postgres` (the throwaway CI service container). Anything else,
  `DB_PASSWORD=<pw>;` included, is flagged — assemble a fake one at runtime.
- **Commit messages can't carry `[skip ci]`-style tokens.** GitHub then skips the push workflows,
  including this scan, so commitlint rejects them (`no-ci-skip`, see the `commitlint` skill).
- **`git push <url>` (no remote name) scans the whole history** — `--remotes=<url>` matches no
  remote-tracking ref, so nothing is excluded. Slow but fails closed.

## Blind spots

- Text that starts with a binary signature (a file opening `\x89PNG…`) is skipped by the scan and
  copied unscanned by showboat's `image`; other binaries (fonts, `.webm`) are scanned as text.
  UTF-16/32 without a BOM isn't decoded (the live-value check still matches ASCII values in it).
- A Postgres URI whose password contains `/`, or `$` followed by a capital, reads as a template to
  the connection-string rule; Cloudflare and R2 credentials have no rule.
- The same rule also skips a password containing `{…}`, `%VAR%` or `$(…)`, one equal to the
  username, one of ≥4 repeated characters, and a unix-socket URI with an empty host
  (`…:pw@/db?host=/var/run/…`).
- A GIF or screenshot that shows a secret can't be scanned.
- Detection only: a commit made with `--no-verify`, without hooks installed, or through the web UI
  is caught only by the push workflow, after it's public — and a `[skip ci]` message made there
  silences even that.
