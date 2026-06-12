# Maintaining the tool (gotchas)

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
