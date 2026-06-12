---
name: batch-commits
description: >
  Use when a finished, green change needs to be committed as SEVERAL logical
  commits and you want to avoid re-running the pre-commit gate on every one. The
  pre-commit hook runs `npm run check:fast` on each commit; splitting a task into
  N commits the normal way runs that identical check N times. This skill's bundled
  script (run it directly: `node .claude/skills/batch-commits/scripts/batch-commit.mjs
  <input-file>`) runs the gate ONCE up front, validates every message with
  commitlint, then creates all the commits with --no-verify — the only sanctioned
  use of --no-verify in alfred. Trigger on:
  "multiple commits", "split into commits", "group commits by concern", "commit
  groups", "batch commit", "create several commits", "commit the work in pieces",
  or any wrap-up where you're about to run `git commit` more than once for one
  finished change.
---

# batch-commits — many commits, one gate run

## What it is and why

The `pre-commit` hook runs root `check:fast` (typecheck → `eslint --fix` →
`prettier --write` → unit tests) on **every** commit. The workflow also tells you
to **group commits by logical concern**, so one ticket becomes N commits — and the
same `check:fast` runs N times.

Here's the key insight: in the documented flow you **finish the work, get `check`
green, then split the finished diff into logical commits**. At that point every
commit is made against the *same* final working tree, and `check:fast` checks the
**whole tree** (there's no lint-staged). So those N runs are N validations of one
identical green state — **N−1 of them are pure redundancy.**

This tool runs that check **exactly once** and creates all the commits. The script
is **self-contained** — run it straight with `node`, no npm script or other
project wiring required:

```bash
node .claude/skills/batch-commits/scripts/batch-commit.mjs <input-file>
```

No coverage is lost (the one run validates the complete end state, same as each
redundant run would), and **`pre-push` / `check:slow` is untouched** — the push
gate (Storybook snapshots + Playwright) still fires.

## When to use it (and when not to)

**Use it** when you have a **finished, green** change and want it as more than one
commit. That's the wrap-up case the workflow describes.

**Don't use it** to commit mid-development, or to sneak past a failing check. If
`check:fast` fails, the tool makes **no commits** — fix the code and re-run, exactly
as the hook would force you to. For a single commit, just `git commit` normally
(the hook is cheap enough once).

## Input format (block text)

One file describes every commit, in order:

```
message: feat(tasks): add inline subtask rows
  frontend/components/TaskRow.tsx
  frontend/components/SubtaskList.tsx

message: test(tasks): cover subtask expansion
  frontend/components/TaskRow.test.tsx
```

- A line starting with `message:` begins a commit; the rest of that line is its
  **single-line** subject (must satisfy commitlint: `type(scope): subject`,
  lower-case scope, lowercase subject, no body/footer).
- The following non-blank lines are **file paths** for that commit (whole trimmed
  line — paths may contain spaces; one path per line).
- Blank lines separate commits; lines starting with `#` are comments.

Write it to a temp file (e.g. `/tmp/commits.txt`) and pass it to the tool.

## What the tool does (all validation happens BEFORE the first commit)

`scripts/batch-commit.mjs` runs from the repo root and:

1. **Parses & structurally validates** the input — every commit has a message and
   ≥1 file, and **no file appears in two commits** (whole-file staging can't split
   one file's changes across commits). Aborts on any problem.
2. **Validates every message with commitlint** the same way the hook does
   (`npx --no -- commitlint --edit <tmpfile>`). `--no-verify` skips the
   `commit-msg` hook, so this up-front pass is the batch's *only* message check.
   Aborts (no commits) if any message is rejected.
3. **Runs `check:fast` once** (the pre-flight gate). This applies `eslint --fix` /
   `prettier --write` (so staging captures the fixed content) and runs typecheck +
   tests. **If it fails, nothing is committed.**
4. **Resets the index** (`git reset`) so only each group's own paths get staged,
   then **dry-run pre-checks** every path (`git add --dry-run`) to catch empty
   groups and pathspec typos — again, before any commit is made.
5. **Creates the commits**: for each group, `git add -- <files>` then
   `git commit -m <message> --no-verify`.
6. **Reports** the commits it made and lists any leftover uncommitted changes (e.g.
   a file a formatter touched that you didn't assign to a group).

## Edge cases & failure modes

- **Fixers mutate files** (`eslint --fix` / `prettier --write`) → handled by
  running the gate in step 3 *before* staging; the fixers are idempotent
  afterward, so staging captures the final content.
- **A bad commit message** → caught in step 2, before any commit.
- **Same file in two commits** → caught in step 1 (hunk-splitting is out of scope).
- **An empty group / a path with no pending changes** → caught in step 4.
- **A pathspec typo** → caught in step 4.
- **Untracked, deleted, or renamed files** → `git add` handles adds and deletions;
  for a rename, list both the old and new path.
- **Leftover changes** (a formatter touched a file you didn't list) → reported in
  step 6, not an error; commit or discard them yourself.
- **Mid-batch failure** (rare, after validation passes) → the tool stops, prints
  which commits landed, and leaves the rest in the working tree. It never
  auto-rolls-back; inspect with `git status` and continue manually.
- **A single commit** → the tool still works (one gate run, one `--no-verify`
  commit), but a plain `git commit` is fine too.

## Why this keeps the guardrails' teeth

`--no-verify` is otherwise forbidden (see CLAUDE.md and the commitlint skill). This
tool is the **sole sanctioned exception** because it doesn't *skip* the gate — it
**runs it once** against the complete working tree (identical coverage to the N
redundant per-commit runs), validates every message with the real commitlint
config, and leaves `pre-push` / `check:slow` fully intact. The integrity argument
is "run the meaningful check once," not "bypass it."

## Maintaining the tool (gotchas)

- The scripts are plain **Node ESM (`.mjs`, no dependencies)** run straight via
  `node` — no build step, no TypeScript. They live in this skill's `scripts/`, not
  a workspace, so they're outside the `check:fast` fan-out. They're deliberately
  **self-contained**: invoke them by path with `node`, never via a project
  `package.json` script, so the skill stays portable and nothing breaks if that
  config changes.
- Pure parsing/validation lives in `scripts/parse.mjs` and is unit-tested with
  `node --test`: run `node --test .claude/skills/batch-commits/scripts/*.test.mjs`.
  Keep new logic testable there.
- The end-to-end behavior is captured in `docs/demos/batch-commits.md` (showboat).
  Re-verify it with `npm run demo -- verify docs/demos/batch-commits.md`.
- Message validation **mirrors the `commit-msg` hook exactly** (`npx --no --
  commitlint --edit`). If the hook's invocation changes, change it here too.
- `node --test <dir>` didn't discover files on this Node build; the test script
  uses an explicit `*.test.mjs` glob instead.
