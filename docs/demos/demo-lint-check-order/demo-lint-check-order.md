---
branch: claude/demo-lint-check-order-fu3p8i
---

# monorepo-wide checks run in the root check commands

*2026-06-16T19:19:38.206Z*

skill-lint (lints all of .claude/skills/) and demo-lint (lints all of docs/demos/) are monorepo-wide checks: their scope is the whole repo, not any one package. Previously each was buried in a workspace's check script (skill-lint inside tools/skill-lint's check:fast; demo-lint inside tools/demo-lint's check:slow), so the root check command — the canonical definition of 'done for the repo' — never mentioned them. They ran only as a side effect of the --workspaces fan-out reaching that workspace.

The refactor hoists both into the root check commands explicitly, composed around the fan-out with &&. The dependency is now greppable in one place — the root script IS the list of what gates the repo:

```bash
node -e "const s=require(\"./package.json\").scripts; console.log(\"check:fast:\", s[\"check:fast\"]); console.log(\"check:slow:\", s[\"check:slow\"])"
```

```output
check:fast: npm run lint:skills -w tools/skill-lint && npm run check:fast --workspaces --if-present
check:slow: npm run lint:demos -w tools/demo-lint && npm run check:slow --workspaces --if-present
```

Hoisting a check to the root means removing it from the workspace, or the fan-out would run it a second time. demo-lint's whole check:slow was just lint:demos, so that script is gone; skill-lint's check:fast keeps only its own package checks:

```bash
node -e "console.log(\"demo-lint scripts:\", Object.keys(require(\"./tools/demo-lint/package.json\").scripts).join(\", \")); console.log(\"skill-lint check:fast:\", require(\"./tools/skill-lint/package.json\").scripts[\"check:fast\"])"
```

```output
demo-lint scripts: typecheck, lint, format, test, lint:demos, check:fast
skill-lint check:fast: npm run typecheck && npm run lint && npm run format && npm run test
```

A gate with no teeth isn't a gate. Negative test 1 — a skill with an over-long description must fail check:fast. Because lint:skills is composed AHEAD of the fan-out, it fails fast: check:fast exits non-zero and the frontend unit tests never run.

```bash
mkdir -p .claude/skills/zzz-demo-broken
printf -- '---\nname: zzz-demo-broken\ndescription: %s\n---\n\n# Broken\n\nbody\n' "$(printf 'x%.0s' $(seq 1 1100))" > .claude/skills/zzz-demo-broken/SKILL.md
npm run check:fast > /tmp/bp-c.log 2>&1; echo "check:fast exit=$?"
grep 'skill-lint:' /tmp/bp-c.log
echo "frontend unit tests ran: $(grep -c 'frontend@0.1.0 test' /tmp/bp-c.log)"
rm -rf .claude/skills/zzz-demo-broken
```

```output
check:fast exit=1
skill-lint: 30 skill(s), 1 error(s), 1 warning(s).
frontend unit tests ran: 0
```

Negative test 2 — a stray file directly in docs/demos/ must fail check:slow. lint:demos is AHEAD of the fan-out, so check:slow exits non-zero in ~1s and the slow Storybook + Playwright suites never run (the original motivation: don't wait minutes to learn a demo doc is missing).

```bash
printf 'stray\n' > docs/demos/zzz-demo-stray.md
npm run check:slow > /tmp/bp-d.log 2>&1; echo "check:slow exit=$?"
grep -E 'no-root-files|demo-lint:' /tmp/bp-d.log
echo "storybook/e2e ran: $(grep -cE 'test:storybook|test:e2e' /tmp/bp-d.log)"
rm -f docs/demos/zzz-demo-stray.md
```

```output
check:slow exit=1
  ✗ error [no-root-files] ../../docs/demos/zzz-demo-stray.md is a file directly in ../../docs/demos/. Every demo lives in its own folder — move it into ../../docs/demos/<branch-or-feature>/.
demo-lint: 1 error(s), 0 warning(s).
storybook/e2e ran: 0
```

Green on a clean tree — both monorepo-wide linters pass, each invoked once from the root:

```bash
npm run lint:skills -w tools/skill-lint 2>/dev/null | grep 'skill-lint:'
npm run lint:demos -w tools/demo-lint 2>/dev/null | grep 'demo-lint:'
```

```output
skill-lint: 29 skill(s), 0 error(s), 1 warning(s).
demo-lint: 0 error(s), 0 warning(s).
```

A new repo-wide rule on this branch: skill-lint now errors when a skill description names the repo (matches /alfred/i) — redundant scope that wastes the front-loaded triggering budget, since the agent already knows the repo from CLAUDE.md. It runs inside check:fast (skill-lint), so it gates every commit:

```bash
mkdir -p .claude/skills/zzz-repo-name
printf -- '---\nname: zzz-repo-name\ndescription: Documents alfred check wiring.\n---\n\n# X\n\nbody\n' > .claude/skills/zzz-repo-name/SKILL.md
npm run lint:skills -w tools/skill-lint > /tmp/bp-e.log 2>&1; echo "lint:skills exit=$?"
grep -E 'description-no-repo-name|skill-lint:' /tmp/bp-e.log
rm -rf .claude/skills/zzz-repo-name
```

```output
lint:skills exit=1
  ✗ error [description-no-repo-name] description names the repo ("alfred"). The agent already knows which repo it's in (CLAUDE.md), so drop it — it wastes the front-loaded triggering budget. Disambiguate which part with "the frontend" / "the monorepo" if needed.
skill-lint: 30 skill(s), 1 error(s), 1 warning(s).
```
