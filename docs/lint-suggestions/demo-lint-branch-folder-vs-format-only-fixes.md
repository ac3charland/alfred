# demo-lint `branch-folder` — a formatting-only fix must still carry a demo doc

**Rule(s):** `demo-lint/branch-folder` (`tools/demo-lint`)
**Package / scope:** repo-wide — the `check:slow` / pre-push gate
**Date / branch:** 2026-09-28 · `claude/format-bookmark-test`

## What happened

`frontend/lib/instapaper/bookmark.test.ts` sat on `main` in a layout Prettier doesn't produce, so
every `check:fast` run rewrote it on unrelated branches. The fix is the formatter's own output
for that one file: 5 lines in, 7 out, the same non-whitespace characters before and after. The
change touches code (`frontend/`), so `branch-folder` fails the push unless a demo doc claims
the branch.

## Why the rule doesn't fit here

CLAUDE.md says trivial, non-behavioural changes (pure refactors, docs, config) need no demo doc.
A whitespace-only diff has no behaviour for a demo to show, so the rule forces a demo whose only
honest content is "the formatter is now a no-op". That is ceremony, not evidence. Both
guardrails are sound on their own; together they give a dead end for the smallest possible code
change.

## Suggested change

Treat a changed code file as docs-like when its old and new contents are identical after
stripping all whitespace, i.e. a formatting-only change. Extend the existing docs-only exemption
in `tools/demo-lint` with that check, so a branch whose every code change is formatting-only
skips `branch-folder`. Compare with `git show <base>:<path>` against the working tree. Any token
change (a trailing comma, quote style or parentheses from Prettier) still counts as code, which
keeps the exemption conservative.

## Workaround used meanwhile

A minimal demo doc that shows the old layout, then shows `lint --fix` followed by `format`
leaving the file unchanged.

## Workarounds to rip out if the rule changes

- [ ] `docs/demos/format-bookmark-test/` — a demo that exists only to satisfy `branch-folder`;
      delete the folder.
