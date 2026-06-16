---
branch: claude/demo-lint-check-order-fu3p8i
---

# demo-lint runs first in check:slow

*2026-06-16T16:33:11.077Z*

Previously, the pre-push hook ran 'npm run check:slow' which fans out to workspaces in declaration order. frontend comes first, so storybook + e2e (5-10 min) ran before tools/demo-lint's lint:demos (< 1 s). A missing demo doc would only error after the slow tests finished.

The fix: run demo-lint explicitly before the workspace fan-out in .husky/pre-push.

```bash
cat .husky/pre-push
```

```output
npm run lint:demos -w tools/demo-lint && npm run check:slow
```

On a feature branch that touches code (any committed change outside docs/), demo-lint now runs first and fails immediately if no demo doc claims the branch. Here it passes on this branch — our demo doc correctly claims it:

```bash
npm run lint:demos -w tools/demo-lint 2>/dev/null
```

```output

> @alfred/demo-lint@0.0.0 lint:demos
> node src/cli.ts


demo-lint: 0 error(s), 0 warning(s).
```
