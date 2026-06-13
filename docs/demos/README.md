# Demo docs

Each demo here is an **executable demo doc**: commentary interleaved with the
commands that were run, their captured output, and (for UI work) screenshots. A
demo doc proves a change actually *does* what it claims — beyond the `check` suites
proving it doesn't regress — and lets a reviewer reproduce it with one command.

These are produced by the self-contained demo CLI in
[`tools/showboat`](../../tools/showboat), run via `npm run demo -- <command>`. See
the [`showboat` skill](../../.claude/skills/showboat/SKILL.md) for the full command
reference and authoring tips.

## Conventions

- **Every demo lives in its own folder** — never a loose file directly in
  `docs/demos/`. The folder is named for the **feature** it demonstrates
  (`docs/demos/<feature-name>/<name>.md`); the doc's images/GIFs/txt sit beside it
  inside that folder. `npm run demo -- init` creates the folder for you.
- **The branch lives in the doc's YAML front matter, not the folder name.** `init`
  stamps `branch: <current-branch>` at the top of the doc (override with
  `--branch <name>`), and `demo-lint` reads it from there — so the folder name is free
  to be a semantic feature name. A legacy folder literally named after the branch still
  counts, for backward compatibility.
- **Link the doc in the PR description.**
- Keep exec blocks **deterministic** so the doc stays verifiable (pipe noisy output
  through `tail`/`grep`/`sort`; avoid timestamps and random paths in captured
  output).

Both rules are enforced by **`demo-lint`** ([`tools/demo-lint`](../../tools/demo-lint)),
which runs in the global `check:slow` on every push.

## Reproduce / verify a demo

```bash
npm run demo -- verify docs/demos/<doc>.md
```

`verify` re-runs every command and diffs the fresh output against what's recorded —
exit 0 if everything still matches, exit 1 (with diffs) if the behavior drifted.
Image entries are skipped. If a command legitimately changed, refresh the doc with
`npm run demo -- verify docs/demos/<doc>.md --output docs/demos/<doc>.md`.
