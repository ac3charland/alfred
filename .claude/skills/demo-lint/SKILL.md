---
name: demo-lint
description: >
  Covers demo-lint, the linter that enforces the docs/demos folder-per-demo
  structure and runs in the global check:slow (pre-push). Use when running or
  interpreting demo-lint, fixing a demo-lint finding, adding or changing one of its
  rules (no-root-files, branch-folder), or wiring the tool into the build. Trigger
  on: "demo-lint", "lint the demos", "demo lint failing", "no-root-files",
  "branch-folder", "demos folder structure", "add a demo-lint rule", or editing
  tools/demo-lint.
---

# demo-lint — lint the docs/demos structure

## What it is and why

`tools/demo-lint` is a small, self-contained TypeScript CLI that enforces how
`docs/demos/` is organized: every demo doc lives in its **own folder**, and on a feature
branch that folder is **named after the branch**. It exists so the folder convention is
enforced mechanically instead of relying on every author remembering it.

It runs in the repo's **`check:slow`** gate (the pre-push hook), not `check:fast` — it
needs the git branch, and a demo doc is the last thing you produce before pushing, so
push-time is when the branch folder must exist.

## Running it

Always go through an `npm run` script, never the binary directly:

```bash
npm run lint:demos -w tools/demo-lint              # lint docs/demos (the check:slow default)
npm run lint:demos -w tools/demo-lint -- <dir>     # lint a different demos directory
npm run lint:demos -w tools/demo-lint -- --branch <name> <dir>  # pretend you're on <name>
```

With no directory it lints `docs/demos` (resolved relative to the tool, so it works from
any cwd). `--branch` overrides the git branch — handy for checking what a given branch
owes, and what the tests/demo use for deterministic output. `--help` prints usage.

## The rules

Both rules are **errors** (exit 1 fails the push).

| Rule | Fires when | Fix |
| --- | --- | --- |
| `no-root-files` | any file other than `README.md` sits **directly** in `docs/demos/` | move it into its own folder: `docs/demos/<branch-or-feature>/` |
| `branch-folder` | you're on a feature branch and `docs/demos/<branch>/` is missing or empty | create the folder and put this branch's demo doc there (`npm run demo -- init docs/demos/<branch>/<name>.md "<title>"`) |

`branch-folder` **skips** trunk (`main`/`master`) and any state where the branch can't be
determined (detached HEAD, no git), so it only fires on a real feature branch.

## Everyday gotchas

- **A slash in the branch name nests.** Branch `claude/foo-bar` owes
  `docs/demos/claude/foo-bar/` — `init` `mkdir -p`s it for you, so just init the doc at
  that path.
- **The branch folder must have content.** An empty `mkdir` doesn't satisfy
  `branch-folder` (and git wouldn't commit an empty dir anyway) — put the demo doc in it.
- **Only `README.md` is allowed at the root.** That allow-list lives in
  `ALLOWED_ROOT_FILES` in `src/demos.ts`; everything else at the root is a finding.
- **It's wired into `check:slow`, not `check:fast`.** The package's `check:slow` script is
  `npm run lint:demos`; the root `check:slow` fan-out picks it up. Its own
  typecheck/lint/format/test live in `check:fast` like every package.

## Maintaining the tool

It's a standard rule-registry split: `src/demos.ts` gathers a pure `DemosContext`
(root files + branch facts), `src/rules.ts` holds the rule registry (add a `Rule` to the
exported `rules` array to lint something new), `src/lint.ts` runs them, and `src/cli.ts`
is the entry point. The same source-maintenance constraints apply as the rest of
`tools/*` — explicit `.ts` import extensions, erasable syntax only, no `process.exit()`
(see the `showboat` skill's maintainer notes). Tests run under ts-jest ESM via the
package's `check:fast`.
