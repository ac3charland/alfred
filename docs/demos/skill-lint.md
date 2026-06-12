# skill-lint: a linter for the skill library

*2026-06-12T17:59:23.868Z*

skill-lint checks every .claude/skills/*/SKILL.md against the skill-creator authoring guidance, and runs inside check:fast. This doc exercises each thing it does: both ways to point it at input (a file path and a glob), all three rules, and the whole-library gate run.

Point it at a specific file (the path argument) — here the skill-lint skill itself, which is compound and passes:

```bash
node tools/skill-lint/src/cli.ts .claude/skills/skill-lint
```

```output

skill-lint: 1 skill(s), 0 error(s), 0 warning(s).
```

Or a glob path (quote it so the shell does not expand it) — here every skill-* skill:

```bash
node tools/skill-lint/src/cli.ts '.claude/skills/skill-*/SKILL.md'
```

```output

.claude/skills/skill-creator/SKILL.md
  ⚠ warn [body-length] body is 562 lines (recommended < 500). Add a layer of hierarchy and move detail into references/ that loads on demand.

skill-lint: 2 skill(s), 0 error(s), 1 warning(s).
```

Rule 1 — description-length (error): a frontmatter description past the ~1024-char cap. Built as a throwaway fixture, linted, then cleaned up:

```bash
mkdir -p tools/skill-lint/tmp-demo-skill
desc=$(printf 'abcdefghij%.0s' $(seq 1 120))
printf '%s\n' '---' 'name: tmp-demo-skill' "description: $desc" '---' '' '# Tmp Demo Skill' '' '## Overview' 'A short body.' > tools/skill-lint/tmp-demo-skill/SKILL.md
node tools/skill-lint/src/cli.ts tools/skill-lint/tmp-demo-skill; echo "exit=$?"
rm -rf tools/skill-lint/tmp-demo-skill
```

```output

tools/skill-lint/tmp-demo-skill/SKILL.md
  ✗ error [description-length] description is 1200 chars (max 1024). Tighten it — lead with what-it-does plus the distinctive keywords in the first ~250 chars and drop redundant scope.

skill-lint: 1 skill(s), 1 error(s), 0 warning(s).
exit=1
```

Rule 2 — body-length (warning): a SKILL.md body past ~500 lines. A warning is advisory — note it exits 0 and does not fail the gate:

```bash
mkdir -p tools/skill-lint/tmp-demo-skill
{ printf '%s\n' '---' 'name: tmp-demo-skill' 'description: A skill with an overlong body.' '---' '' '# Tmp Demo Skill' ''; for i in $(seq 1 600); do printf 'Line %s.\n' "$i"; done; } > tools/skill-lint/tmp-demo-skill/SKILL.md
node tools/skill-lint/src/cli.ts tools/skill-lint/tmp-demo-skill; echo "exit=$?"
rm -rf tools/skill-lint/tmp-demo-skill
```

```output

tools/skill-lint/tmp-demo-skill/SKILL.md
  ⚠ warn [body-length] body is 603 lines (recommended < 500). Add a layer of hierarchy and move detail into references/ that loads on demand.

skill-lint: 1 skill(s), 0 error(s), 1 warning(s).
exit=0
```

Rule 3 — compound-toc (error): a skill that bundles a resource folder (references/) but has no Table of Contents:

```bash
mkdir -p tools/skill-lint/tmp-demo-skill/references
printf '%s\n' '---' 'name: tmp-demo-skill' 'description: A compound skill missing its table of contents.' '---' '' '# Tmp Demo Skill' '' '## Overview' 'Content.' > tools/skill-lint/tmp-demo-skill/SKILL.md
node tools/skill-lint/src/cli.ts tools/skill-lint/tmp-demo-skill; echo "exit=$?"
rm -rf tools/skill-lint/tmp-demo-skill
```

```output

tools/skill-lint/tmp-demo-skill/SKILL.md
  ✗ error [compound-toc] compound skill (bundles references/) has no Table of Contents. Add a "## Contents" section near the top that lists the body sections and links the bundled resources, so a reader discovers them on the first read.

skill-lint: 1 skill(s), 1 error(s), 0 warning(s).
exit=1
```

All together — linting the whole library, which is exactly what check:fast runs. Every real skill passes; skill-creator's body-length warning is advisory:

```bash
node tools/skill-lint/src/cli.ts
```

```output

.claude/skills/skill-creator/SKILL.md
  ⚠ warn [body-length] body is 562 lines (recommended < 500). Add a layer of hierarchy and move detail into references/ that loads on demand.

skill-lint: 26 skill(s), 0 error(s), 1 warning(s).
```
