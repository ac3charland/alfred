# Demo docs

Each markdown file here is an **executable demo doc**: commentary interleaved with
the commands that were run, their captured output, and (for UI work) screenshots.
A demo doc proves a change actually *does* what it claims — beyond the `check`
suites proving it doesn't regress — and lets a reviewer reproduce it with one
command.

These are produced by the self-contained demo CLI in
[`tools/showboat`](../../tools/showboat), run via `npm run demo -- <command>`. See
the [`showboat` skill](../../.claude/skills/showboat/SKILL.md) for the full command
reference and authoring tips.

## Conventions

- **One doc per feature/branch**, named for the change (e.g. `inline-subtasks.md`).
- **Link the doc in the PR description.**
- Keep exec blocks **deterministic** so the doc stays verifiable (pipe noisy output
  through `tail`/`grep`/`sort`; avoid timestamps and random paths in captured
  output).

## Reproduce / verify a demo

```bash
npm run demo -- verify docs/demos/<doc>.md
```

`verify` re-runs every command and diffs the fresh output against what's recorded —
exit 0 if everything still matches, exit 1 (with diffs) if the behavior drifted.
Image entries are skipped. If a command legitimately changed, refresh the doc with
`npm run demo -- verify docs/demos/<doc>.md --output docs/demos/<doc>.md`.
