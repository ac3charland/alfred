---
name: showboat
description: >
  Use when building a "demo doc" that proves an alfred change works — the
  capture-the-behavior step at the end of the workflow, before committing and in
  the PR. Covers the self-contained, showboat-compatible CLI at tools/showboat
  (run via `npm run demo -- <command>`): init / note / exec / image / pop /
  verify / extract, the markdown format it emits, where demo docs live
  (docs/demos/), embedding live-UI screenshots via the Playwright `screenshot`
  helper, how `verify` re-runs and diffs exec blocks, and the gotchas of
  maintaining the tool (Node native-TS `.ts` imports, erasable syntax, shell
  quoting, output determinism). Trigger on: "demo doc", "showboat", "npm run
  demo", "prove it works", "demonstrate the change", "verify the demo",
  "screenshot the UI for the PR".
---

# showboat — executable demo docs for alfred

## What it is and why

`tools/showboat` is a small, **self-contained** TypeScript CLI (modeled on Simon
Willison's [showboat](https://github.com/simonw/showboat)) that builds a markdown
**demo doc**: commentary + executed commands + their captured output (+ optional
screenshots). It turns "I ran it and it worked" into a reproducible artifact you
commit and link in the PR.

The deterministic suites (`check`) prove a change *doesn't regress*. A demo doc
proves the *new behavior actually happens* and lets a reviewer re-run it with one
command. Build one as part of finishing any user-facing or behavioral change.

**Portability:** it runs on Node alone — no Go, no Python, no network, no binaries
in git. It works identically on a local machine, Claude Code for web, and the
claude-sandbox Docker image with **no environment-specific setup**.

## Running it

Always go through the root script (never call the tool directly):

```bash
npm run demo -- <command> [args]
```

`--` passes everything after it to the CLI. Paths are resolved from the repo root
(where you run npm), so `docs/demos/my-feature.md` lands in the right place.

## Commands

| Command | What it does |
| --- | --- |
| `init <file> <title>` | Start a new doc (H1 title + ISO timestamp). |
| `note <file> [text]` | Append commentary. Reads stdin if `text` is omitted. |
| `exec <file> <lang> [code]` | Run code, capture output, append both. Echoes the output and **exits with the command's exit code**. Reads stdin if `code` is omitted. |
| `image <file> <path \| '![alt](path)'>` | Copy an image next to the doc and embed it. |
| `pop <file>` | Remove the most recent entry (an exec drops its code *and* output). Use after a command errored and you don't want it in the doc. |
| `verify <file> [--output <new>]` | Re-run every exec block and diff against the recorded output. Exit 1 on any mismatch, 0 if all match. `--output` writes a refreshed copy. |
| `extract <file> [--filename <name>]` | Print the `showboat` commands that recreate the doc. |

Global: `--workdir <dir>` sets the directory exec blocks run in (default: cwd).
`--version`, `--help`.

`exec` languages: `bash`/`sh`/`shell`/`zsh`/`console` (and anything unrecognized)
run through the system shell; `node`/`js`/`javascript` run via `node -e`;
`python`/`python3` via `python3 -c`. Prefer `bash` and `node` so `verify` works in
every environment.

## A typical demo

```bash
DOC=docs/demos/inline-subtasks.md
npm run demo -- init "$DOC" "Inline subtask rows"
npm run demo -- note "$DOC" "The tasks API now returns nested subtasks."
npm run demo -- exec "$DOC" bash "npm run test -w frontend -- subtasks 2>&1 | tail -5"
npm run demo -- exec "$DOC" bash "curl -s localhost:3000/api/tasks | head -c 400"
npm run demo -- verify "$DOC"        # confirm it reproduces before you commit
```

Commit the doc under `docs/demos/` and link it in the PR description.

## Embedding a live-UI screenshot (reuses Playwright)

alfred is a Next.js app, so UI changes should *show* the screen. Reuse the
sandbox-aware Chromium the E2E suite already installs — no new dependency:

```bash
npm run dev -w frontend &                                    # start the app
npm run screenshot -w frontend -- http://localhost:3000 /tmp/shot.png
npm run demo -- image docs/demos/<doc>.md /tmp/shot.png
```

`verify` **skips image entries**, so screenshots never make verification flaky.
The `screenshot` helper lives at `frontend/scripts/screenshot.mjs`.

## How `verify` works (and how to keep it green)

`verify` re-executes each exec block in the doc's workdir and compares the fresh
output to what's recorded; image and note entries are skipped. Keep demos
reproducible:

- Prefer deterministic commands. Pipe noisy output through `tail`/`head`/`grep`,
  or `sort` it, so it's stable.
- Avoid timestamps, random ports, absolute temp paths, and anything machine- or
  time-specific in captured output.
- Color is already disabled (the runner sets `NO_COLOR`/`FORCE_COLOR`), so you
  don't need to.
- If a command legitimately changes, re-run `verify --output` and commit the
  refreshed doc.

## Markdown format

```markdown
# Title

*2026-06-10T12:00:00.000Z*

A note.

```bash
echo hi
```

```output
hi
```
```

This matches upstream showboat closely, so a doc here could later be re-driven by
the real Go binary if we ever vendor it.

## Maintaining the tool (gotchas)

The CLI is run straight from TypeScript source via Node's native type-stripping
(`node tools/showboat/src/cli.ts`) — there is **no build step**. That imposes
constraints when editing `tools/showboat/src/`:

- **Import local modules with the explicit `.ts` extension** (`./document.ts`).
  Node's loader throws `ERR_MODULE_NOT_FOUND` on extensionless relative imports.
  `tsconfig` sets `allowImportingTsExtensions` + `noEmit`; the package ESLint
  config sets `import/extensions` to require `ts: 'always'`; Jest strips the `.ts`
  via `moduleNameMapper` so it resolves the same module at test time.
- **Erasable syntax only** — no `enum`, `namespace`, parameter properties, or
  `import =`. `tsconfig` enforces this with `erasableSyntaxOnly: true`.
- **No `process.exit()`** — `unicorn/no-process-exit` forbids it (and it can
  truncate piped output). Return an exit code from `main` and set
  `process.exitCode` instead.
- **Quote `exec` code carefully.** It's one shell string; wrap multi-word code in
  quotes. `extract` already POSIX-quotes regenerated commands.
- Tests run under ts-jest ESM: `npm run test -w tools/showboat` sets
  `NODE_OPTIONS=--experimental-vm-modules`.

Everything is gated by the package's own `check:fast` (typecheck → lint → format →
test), which the root fan-out runs on every commit.
