# skill-lint: a linter for the skill library

*2026-06-12T17:35:22.327Z*

skill-lint checks every .claude/skills/*/SKILL.md against the skill-creator authoring guidance. It runs inside check:fast and ships three rules: a description-length error (~1024-char cap), a body-length warning (>500 lines), and a compound-TOC error (a skill bundling scripts/ or references/ needs a Table of Contents near the top). Rules live in an extensible registry — adding one is appending a pure function to an array.

Smoke test against a single skill (the skill-lint doc skill itself, which is compound and passes):

```bash
node tools/skill-lint/src/cli.ts .claude/skills/skill-lint
```

```output

skill-lint: 1 skill(s), 0 error(s), 0 warning(s).
```

The compound-TOC rule catches a skill that bundles a resource folder but has no Table of Contents. Here we build a throwaway fixture, lint it, and clean up:

```bash
mkdir -p tools/skill-lint/tmp-demo-skill/references
printf "%s\n" "---" "name: tmp-demo-skill" "description: A compound skill missing its table of contents." "---" "" "# Tmp Demo Skill" "" "## Body" "Content." > tools/skill-lint/tmp-demo-skill/SKILL.md
node tools/skill-lint/src/cli.ts tools/skill-lint/tmp-demo-skill; echo "exit=$?"
rm -rf tools/skill-lint/tmp-demo-skill
```

```output

tools/skill-lint/tmp-demo-skill/SKILL.md
  ✗ error [compound-toc] compound skill (bundles references/) has no Table of Contents. Add a "## Contents" section near the top that lists the body sections and links the bundled resources, so a reader discovers them on the first read.

skill-lint: 1 skill(s), 1 error(s), 0 warning(s).
exit=1
```

Linting the whole library (this is what check:fast runs via the tools/skill-lint workspace). Every skill passes; skill-creator's body-length warning is advisory and does not fail the gate:

```bash
node tools/skill-lint/src/cli.ts
```

```output

.claude/skills/skill-creator/SKILL.md
  ⚠ warn [body-length] body is 562 lines (recommended < 500). Add a layer of hierarchy and move detail into references/ that loads on demand.

skill-lint: 26 skill(s), 0 error(s), 1 warning(s).
```
