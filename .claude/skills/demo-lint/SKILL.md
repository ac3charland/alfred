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
branch some demo doc must **claim that branch** in its YAML front matter
(`branch: <name>`). The folder name itself is free — pick a semantic, feature-related
name — because the branch lives in front matter, not in the path. `npm run demo -- init`
stamps that front matter automatically. It exists so the convention is enforced
mechanically instead of relying on every author remembering it.

It runs in the repo's **`check:slow`** gate (the pre-push hook), not `check:fast` — it
needs the git branch, and a demo doc is the last thing you produce before pushing, so
push-time is when the branch's demo must exist.

## Running it

Always go through an `npm run` script, never the binary directly:

```bash
npm run lint:demos -w tools/demo-lint              # the gate: only demos changed vs trunk
npm run audit:demos                                # every demo (root script, --all)
npm run lint:demos -w tools/demo-lint -- <dir>     # lint a different demos directory
npm run lint:demos -w tools/demo-lint -- --branch <name> <dir>  # pretend you're on <name>
```

With no directory it lints `docs/demos` (resolved relative to the tool, so it works from
any cwd). The gate scopes the content/structure checks to demos **changed on this branch vs
trunk**, so a newly-added rule never retroactively fails an untouched demo; `--all` (or the
root `audit:demos`) lints every demo, and an unknown diff conservatively lints everything.
`branch-folder` always evaluates the whole tree — it's about what this branch owes, not what
changed. `--branch` overrides the git branch — handy for checking what a given branch owes,
and what the tests/demo use for deterministic output. `--help` prints usage.

## The rules

Both rules are **errors** (exit 1 fails the push).

| Rule | Fires when | Fix |
| --- | --- | --- |
| `no-root-files` | any file other than `README.md` sits **directly** in `docs/demos/` | move it into its own folder: `docs/demos/<feature-name>/` |
| `branch-folder` | you're on a feature branch that touches code (changes outside `docs/`) and no demo doc claims it — no doc has `branch: <current-branch>` in front matter (and no legacy folder named after the branch has content) | capture this branch's demo in its own (semantically-named) folder: `npm run demo -- init docs/demos/<feature-name>/<name>.md "<title>"` stamps the branch into front matter for you |

`branch-folder` **skips** trunk (`main`/`master`), any state where the branch can't be
determined (detached HEAD, no git), and a **docs-only** branch — one whose every change
vs trunk lives under `docs/` — so it only fires on a real feature branch that touches code.
The diff is computed against the first existing trunk ref (`origin/main`, `main`,
`origin/master`, `master`); when it can't be computed the branch is treated **conservatively**
as touching code, so the exception is never granted on a guess.

## Everyday gotchas

- **The folder name is decoupled from the branch.** `branch-folder` is satisfied by a
  demo doc that declares `branch: <current-branch>` in front matter — the folder can be
  any semantic name. `npm run demo -- init` writes that front matter, so the normal
  authoring flow just works; you don't name the folder after the branch anymore.
- **A legacy branch-named folder still counts.** For backward compatibility, a folder
  literally named after the branch (`docs/demos/claude/foo-bar/`) with content also
  satisfies the rule even without front matter. New demos should rely on front matter.
- **The branch claim must be real content.** An empty `mkdir` satisfies nothing (and git
  wouldn't commit an empty dir) — put a demo doc with the right front matter in the folder.
- **Only `README.md` is allowed at the root.** That allow-list lives in
  `ALLOWED_ROOT_FILES` in `src/demos.ts`; everything else at the root is a finding.
- **It's wired into `check:slow`, not `check:fast`.** The package's `check:slow` script is
  `npm run lint:demos`; the root `check:slow` fan-out picks it up. Its own
  typecheck/lint/format/test live in `check:fast` like every package.

## Maintaining the tool

It's a standard rule-registry split: `src/demos.ts` gathers a pure `DemosContext`
(root files + branch facts + `declaredBranches` + `hasChangesOutsideDocs`), `src/rules.ts`
holds the rule registry (add a `Rule` to the exported `rules` array to lint something new),
`src/lint.ts` runs them, and `src/cli.ts` is the entry point. Git facts are computed in the
CLI and injected for testability: `currentBranch()` and `changedPathsSinceTrunk()` shell out
to git, the CLI passes both into `gatherDemos(demosDir, cwd, branch, changedPaths, changedOnly)`,
and tests pass literals (so the raw git calls stay untested). `hasChangesOutsideDocs` is
`changedPaths` classified by whether any path falls outside `docs/`, defaulting to `true` on an
`undefined` (unknown) diff so the docs-only exception is never granted on a guess. `changedOnly`
(the gate, set when no dir/`--all` is given) narrows `rootFiles` + `demoContents` to demos whose
key — the first segment under `docs/demos/`, via `changedDemoKeys` — changed vs trunk; an
unknown diff lints everything. `declaredBranches` is built by walking every
`*.md` under `docs/demos/` and reading each doc's `branch:` front matter via
`readDeclaredBranch` (a deliberately tiny YAML-scalar reader — demo-lint needs only that
one field, so it does **not** depend on `tools/showboat`'s parser). The same
source-maintenance constraints apply as the rest of `tools/*` — explicit `.ts` import
extensions, erasable syntax only, no `process.exit()` (see the `showboat` skill's
maintainer notes). Tests run under ts-jest ESM via the package's `check:fast`.
