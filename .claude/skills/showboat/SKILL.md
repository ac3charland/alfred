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

## Choosing your evidence: show the change, don't re-test it

A demo must show the **new behavior actually happening**. Pick the evidence that
*shows* it — and match the evidence to whether the change has a visual surface:

- **Anything visual — a screen, a component, a layout/styling/copy tweak → the
  primary evidence is a screenshot of the rendered UI.** The reviewer should *see*
  the change. Drive to the exact state the change affects (the right view, the
  right data) and shoot it. See the screenshot recipe below.
- **Only a change with no visual surface — an API route, a data-layer function, a
  migration, a CLI/tooling change → uses CLI/`exec` output** as its evidence: the
  request + response, the query result, the command's output.

**Do not demo a UI change by re-running the unit / integration suite.** The `check`
suites already run in the pre-commit and pre-push hooks — replaying their green
output in a demo proves nothing the gates didn't, and shows the reviewer *nothing
they can see*. The demo's job is the part the gates *don't* do: make the new
behavior visible and reproducible.

Tell-tale sign you're capturing the wrong layer: if you're piping, `grep`-ing, or
JSON-parsing test output to wrangle it into something "presentable" for a demo,
stop — that effort is the symptom. Screenshot the UI instead (for a visual change)
or capture a real request/response (for a non-visual one).

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

## A typical demo (non-visual change — CLI evidence)

For a change with **no visual surface** (here, an API endpoint), the evidence is a
real request and its response:

```bash
DOC=docs/demos/items-endpoint.md
npm run demo -- init "$DOC" "Items endpoint returns nested subtasks"
npm run demo -- note "$DOC" "GET /api/items now nests children under each parent."
npm run demo -- exec "$DOC" bash "curl -s localhost:3000/api/items | head -c 400"
npm run demo -- verify "$DOC"        # confirm it reproduces before you commit
```

Commit the doc under `docs/demos/` and add a **live, clickable link** to it in the PR
description (see *Linking the demo in the PR* below). For a **visual** change, the
centrepiece is a screenshot instead — see below.

## Screenshotting the UI (the evidence for any visual change)

Reuse the sandbox-aware Chromium the E2E suite installs (`npm run setup:chromium`
extracts it to `/tmp/chromium`) via the `screenshot` helper
(`frontend/scripts/screenshot.mjs`). `verify` **skips image entries**, so
screenshots never make verification flaky. There are two ways to put the rendered
UI in front of it — reach for **Storybook first**; it's the one that always works
here.

### Storybook — preferred (no auth, no data seeding, always reproducible)

Components render in isolation, **outside the Supabase auth gate**, with per-story
store seeds (`parameters.store.{folders,tasks}` — see `.storybook/preview.ts`). If
no story exercises the exact state your change affects, **add one** — it doubles as
a Storybook snapshot test. Build the static Storybook, serve it, and shoot the
story's `iframe.html`:

```bash
npm run storybook:build -w frontend           # also run setup:chromium once if /tmp/chromium is absent
npm run serve:storybook -w frontend &         # http-server on :6006
npx wait-on http://127.0.0.1:6006
# story id = kebab(title)--kebab(exportName), e.g. title 'Tasks/TaskRow' + export
# 'CompletedInFolder' → tasks-taskrow--completed-in-folder
npm run screenshot -w frontend -- \
  "http://127.0.0.1:6006/iframe.html?id=tasks-taskrow--completed-in-folder&viewMode=story" /tmp/shot.png
npm run demo -- image docs/demos/<doc>.md /tmp/shot.png
```

Then **look at the PNG** (Read it) to confirm it actually shows the change before
embedding — a green screenshot of the wrong state is worse than no screenshot.

**Kill the serve before you push.** `serve:storybook` binds port **6006** — the same
port the pre-push hook's `test:storybook` uses. A background server left running
makes the hook die with `EADDRINUSE: address already in use 0.0.0.0:6006` and blocks
the push. After screenshotting, stop it (`pkill -f http-server`) and confirm 6006 is
free before `git push`.

### The live app route — only with real Supabase creds + seeded data

`npm run dev -w frontend &` then screenshotting `localhost:3000/<route>` *seems*
simplest, but **every protected route is auth-gated**. With no real Supabase env (a
fresh sandbox / Claude Code on web) `getUser()` returns null and the middleware
redirects to `/login` — so you'd screenshot the login page, not your screen (this
is exactly what `e2e/home.spec.ts` asserts). Driving the real route needs real
credentials *and* seeded rows for the view, and is **not reproducible in CI or the
web sandbox**. Prefer Storybook unless you specifically have a live, authenticated,
data-seeded environment.

## Linking the demo in the PR (a live, clickable link)

A demo doc only helps a reviewer if they can **open it from the PR and see the embedded
screenshots/diffs rendered**. A bare path (`docs/demos/foo.md`) or a filename isn't
clickable on the PR page, and a relative link doesn't resolve there. So the PR
**description body must contain a live, absolute GitHub link** to the doc on the PR's
**head** branch:

```text
📝 **Demo:** [docs/demos/<name>.md](https://github.com/<owner>/<repo>/blob/<branch>/docs/demos/<name>.md)
```

- `<branch>` is the PR's **head** branch (the one you pushed) — not `main`, where the doc
  may not exist yet. The link then tracks the doc as it lands.
- Don't hardcode `<owner>/<repo>` / `<branch>` — read them from the PR, or from
  `git remote get-url origin` + `git rev-parse --abbrev-ref HEAD`.
- Use the **blob** URL (`/blob/<branch>/…`): GitHub renders the markdown — images, diffs and
  all. A `raw.githubusercontent.com` / `?raw=1` URL shows source text instead.
- **Always include it when you open the PR.** If a PR for the branch **already exists**
  (e.g. opened from the Claude Code UI), **edit the body** to add the link if it's missing
  (`gh pr edit --body` / the `update_pull_request` MCP tool — see the `gh-cli` skill). This is
  the one PR edit that's always worth making.

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
- **Don't put a triple-backtick fenced code block inside a `note`.** Notes are raw
  markdown, so an embedded fence is reparsed as an `exec` block on the next load —
  it injects a stray empty `output` block, and `verify` will then try to *run* that
  text. Show a command you're only mentioning with **inline** backticks; run a
  command for real with `exec`.

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
