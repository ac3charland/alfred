---
branch: claude/laughing-lamport-m80h1g
---

# demo-lint exempts docs-only branches from the branch-folder rule

*2026-06-14T18:26:58.602Z*

demo-lint's `branch-folder` rule requires every feature branch to own a demo doc. That makes sense for behavioral changes, but it also nags a pure **docs-only** branch (e.g. adding `docs/code-module-spec.md`), which has nothing to demonstrate. This change adds a narrow carve-out: a feature branch whose entire diff vs the trunk merge-base lives under `docs/` no longer owes a demo. Any change outside `docs/` makes the rule fire exactly as before, and an undeterminable diff stays conservative (still owes one).

Driving the real `branch-folder` rule directly (via `gatherDemos` + the rule's `check`) for an undeclared feature branch that owns no demo. The only variable is the set of changed paths. An empty result means the rule is satisfied (exempt); `["branch-folder"]` means it fires.

```bash
node docs/demos/demo-lint-docs-exception/check-exception.mjs 2>/dev/null
```

```output
only docs/ changed   -> []
a non-docs change    -> ["branch-folder"]
docs + a tool change -> ["branch-folder"]
```

Only the docs-only change is exempt; a non-docs change — and a mixed diff that touches even one non-docs file — still fires. The CLI's own `--help` now documents the carve-out:

```bash
npm run --silent lint:demos -w tools/demo-lint -- --help 2>/dev/null | grep -i 'docs-only'
```

```output
                     A docs-only branch (every change under docs/) is exempt.
```
