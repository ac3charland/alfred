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
  use of --no-verify in the repo. Trigger on:
  "multiple commits", "split into commits", "group commits by concern", "commit
  groups", "batch commit", "create several commits", "commit the work in pieces",
  or any wrap-up where you're about to run `git commit` more than once for one
  finished change.
---

# batch-commits — many commits, one gate run

## Contents

- [What it is and how to invoke](#what-it-is-and-how-to-invoke)
- [When to use it (and when not to)](#when-to-use-it-and-when-not-to)
- [Input file format](#input-file-format)
- [What the tool does (all validation happens BEFORE the first commit)](#what-the-tool-does-all-validation-happens-before-the-first-commit)
- [Why this keeps the guardrails' teeth](#why-this-keeps-the-guardrails-teeth)
- [Further Reading](#further-reading)
- **references/**
  - [failure-modes.md](./references/failure-modes.md)
  - [maintenance-gotchas.md](./references/maintenance-gotchas.md)
- **scripts/**
  - [batch-commit.mjs](./scripts/batch-commit.mjs)
  - [parse.mjs](./scripts/parse.mjs)
  - [parse.test.mjs](./scripts/parse.test.mjs)

## What it is and how to invoke

The `pre-commit` hook runs root `check:fast` (typecheck → `eslint --fix` → `prettier --write` → unit tests) on **every** commit. 
When committing by logical concern, this means `check:fast` is run multiple redundant times for the same set of changes.

This script addresses the problem by running that check **exactly once** and creating all the commits:

```bash
node .claude/skills/batch-commits/scripts/batch-commit.mjs <input-file>
```

No coverage is lost (the one run validates the complete end state, same as each
redundant run would), and **`pre-push` / `check:slow` is untouched** — the push
gate (Storybook snapshots + Playwright) still fires as-is.

## When to use it (and when not to)

**Use it** when you have a **finished, green** change and want it as more than one
commit. That's the wrap-up case described in [CLAUDE.md § End of Workflow](../../../CLAUDE.md#end-of-workflow-committing-pushing--pr).

**Don't use it** to commit mid-development, or to sneak past a failing check. If
`check:fast` fails, the tool makes **no commits** — fix the code and re-run, exactly
as the hook would force you to. For a single commit, just `git commit` normally
(the hook is cheap enough once).

## Input file format

One file describes every commit, in order:

```txt
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

`scripts/batch-commit.mjs`:

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


## Why this keeps the guardrails' teeth

`--no-verify` is otherwise forbidden (see CLAUDE.md and the commitlint skill). This
tool is the **sole sanctioned exception** because it doesn't *skip* the gate — it
**runs it once** against the complete working tree (identical coverage to the N
redundant per-commit runs), validates every message with the real commitlint
config, and leaves `pre-push` / `check:slow` fully intact. The integrity argument
is "run the meaningful check once," not "bypass it."

## Further Reading

- Getting unexpected output? See [failure-modes.md](./references/failure-modes.md)
- Updating/maintaining the tool? See [maintenance-gotchas.md](./references/maintenance-gotchas.md)