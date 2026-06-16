---
branch: claude/demo-lint-check-order-fu3p8i
---

# monorepo-wide checks: hoisted to root, scoped to changes

*2026-06-16T20:10:31.619Z*

skill-lint (all of .claude/skills/) and demo-lint (all of docs/demos/) are monorepo-wide checks. This branch (1) hoists both into the root check commands instead of burying them in a workspace's script, (2) adds skill-lint rules for repo-name-in-description and over-long descriptions, and (3) scopes the skill-lint GATE to only the skills you changed, with an audit variant for the full sweep.

1) Hoisted into the root, composed around the --workspaces fan-out with && — the root script is now the greppable list of what gates the repo:

```bash
node -e "const s=require(\"./package.json\").scripts; for (const k of [\"check:fast\",\"check:slow\",\"audit:skills\"]) console.log(k+\":\", s[k])"
```

```output
check:fast: npm run lint:skills -w tools/skill-lint && npm run check:fast --workspaces --if-present
check:slow: npm run lint:demos -w tools/demo-lint && npm run check:slow --workspaces --if-present
audit:skills: npm run lint:skills:audit -w tools/skill-lint
```

Each was removed from its workspace so the fan-out never double-runs it (demo-lint's whole check:slow was just lint:demos, so it's gone; skill-lint's check:fast keeps only its own package gate):

```bash
node -e "console.log(\"demo-lint scripts:\", Object.keys(require(\"./tools/demo-lint/package.json\").scripts).join(\", \")); console.log(\"skill-lint check:fast:\", require(\"./tools/skill-lint/package.json\").scripts[\"check:fast\"])"
```

```output
demo-lint scripts: typecheck, lint, format, test, lint:demos, check:fast
skill-lint check:fast: npm run typecheck && npm run lint && npm run format && npm run test
```

Because lint:demos is composed AHEAD of the fan-out, a demos violation fails the push in ~1s — the slow Storybook + Playwright suites never run:

```bash
printf 'stray\n' > docs/demos/zzz-demo-stray.md
npm run check:slow > /tmp/d.log 2>&1; echo "check:slow exit=$?"
grep -E 'no-root-files|demo-lint:' /tmp/d.log
echo "storybook/e2e ran: $(grep -cE 'test:storybook|test:e2e' /tmp/d.log)"
rm -f docs/demos/zzz-demo-stray.md
```

```output
check:slow exit=1
  ✗ error [no-root-files] ../../docs/demos/zzz-demo-stray.md is a file directly in ../../docs/demos/. Every demo lives in its own folder — move it into ../../docs/demos/<branch-or-feature>/.
demo-lint: 1 error(s), 0 warning(s).
storybook/e2e ran: 0
```

2) Two new skill-lint rules, shown via the audit (it lints the whole library, so it catches a brand-new untracked skill regardless of git state). A description that names the repo is an ERROR:

```bash
mkdir -p .claude/skills/zzz-repo-name
printf -- '---\nname: zzz-repo-name\ndescription: Documents alfred check wiring.\n---\n\n# X\n\nbody\n' > .claude/skills/zzz-repo-name/SKILL.md
npm run audit:skills > /tmp/a.log 2>&1; echo "audit exit=$?"
grep -E 'description-no-repo-name' /tmp/a.log
rm -rf .claude/skills/zzz-repo-name
```

```output
audit exit=1
  ✗ error [description-no-repo-name] description names the repo ("alfred"). The agent already knows which repo it's in (CLAUDE.md), so drop it — it wastes the front-loaded triggering budget. Disambiguate which part with "the frontend" / "the monorepo" if needed.
```

A description under the 1024 hard cap but past the 700-char soft target is an advisory WARNING (never fails the gate) — a nudge to re-check it for smuggled-in content:

```bash
mkdir -p .claude/skills/zzz-verbose
DESC=$(printf 'a%.0s' $(seq 1 850))
printf -- '---\nname: zzz-verbose\ndescription: %s\n---\n\n# X\n\nbody\n' "$DESC" > .claude/skills/zzz-verbose/SKILL.md
npm run audit:skills > /tmp/v.log 2>&1; echo "audit exit=$? (0 — a warning never fails)"
grep 'is 850 chars' /tmp/v.log
rm -rf .claude/skills/zzz-verbose
```

```output
audit exit=0 (0 — a warning never fails)
  ⚠ warn [description-tightness] description is 850 chars (recommended < 700). Check whether it includes rule content, implied context (the repo or package it's in), or other extraneous information — a description states the subject and trigger conditions, not the body's guidance.
```

3) The check:fast GATE (lint:skills, no args) lints only the skills changed vs trunk, so a long-standing description elsewhere never nags an unrelated commit; the path-to-skill mapping and changed-set filter are unit-tested in tools/skill-lint/src/git.test.ts. The audit is the full sweep — run it after adding/tightening a rule. Here the whole library is clean (no errors):

```bash
npm run audit:skills 2>/dev/null | grep -oE '[0-9]+ skill\(s\), [0-9]+ error\(s\)'
```

```output
30 skill(s), 0 error(s)
```
