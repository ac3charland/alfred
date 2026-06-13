---
branch: claude/nice-gauss-870l2v
---

# Fail-fast check scripts

*2026-06-13T04:16:07.347Z*

Both check:fast and check:slow now use &&-chained workspace calls so any failing step stops the whole script immediately. Previously, npm --workspaces continued through all workspaces even after a failure. check:slow also now runs demo-lint first, before the heavier frontend Storybook/Playwright checks.

```json
cat package.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); console.log(JSON.stringify({check:p.scripts.check,'check:fast':p.scripts['check:fast'],'check:slow':p.scripts['check:slow']},null,2))"
```

```output
{
  "check": "npm run check:fast && npm run check:slow",
  "check:fast": "npm run check:fast -w frontend && npm run check:fast -w workers && npm run check:fast -w @alfred/showboat && npm run check:fast -w @alfred/demo-lint && npm run check:fast -w @alfred/skill-lint",
  "check:slow": "npm run check:slow -w @alfred/demo-lint && npm run check:slow -w frontend"
}
```
