---
name: skill-lint
description: >
  Covers skill-lint, the linter that checks SKILL.md files for deterministic failure modes.
  Use when running or interpreting skill-lint, fixing a skill-lint finding, adding or changing
  a lint rule, or wiring the tool into the build. Trigger on: "skill-lint", "lint the skills",
  "skill lint failing", "compound-toc",
  "description too long", "description too verbose", "description names the repo", "SKILL.md
  too long", "add a skill-lint rule", or editing tools/skill-lint.
---

# skill-lint — lint the skill library

## Contents

**This file**

- [What it is and why](#what-it-is-and-why)
- [Running it](#running-it)
- [The rules](#the-rules)
- [Reading and fixing findings](#reading-and-fixing-findings)
- [Everyday gotchas](#everyday-gotchas)

**Bundled resources**

- **references/**
  - [extending-and-wiring.md](./references/extending-and-wiring.md) — the rule-registry
    architecture, how to add a rule, where the thresholds come from, how the tool is
    wired into `check:fast`, and the gotchas of maintaining its TypeScript source

## What it is and why

`tools/skill-lint` is a small, self-contained TypeScript CLI that lints the
`.claude/skills/*/SKILL.md` files against the conventions in the `skill-creator`
skill — the same way ESLint guards the app code. It exists so the guidance Claude is
told to follow (tight descriptions, lean bodies, a navigable index for compound skills)
is enforced mechanically instead of relying on every author remembering it.

It runs as part of the repo's `check:fast` gate (so the pre-commit hook catches a bad
skill before it lands), and you can also run it by hand any time.

## Running it

Always go through an `npm run` script, never the binary directly:

```bash
npm run lint:skills -w tools/skill-lint            # the gate: only skills changed vs trunk
npm run audit:skills                               # every skill (the full sweep), from any cwd
npm run lint:skills -w tools/skill-lint -- <path>  # lint a specific file, dir, or glob
```

**Two modes.** With no argument, `lint:skills` is the **check:fast gate**: it lints only the
skills **changed on this branch vs trunk**, so editing one skill never surfaces findings on
the rest of the library (this is what keeps the advisory `description-tightness` warning from
spamming every commit). The **audit** (`--all`, exposed as the root `audit:skills` script /
`lint:skills:audit` in the package) lints **every** skill — run it after adding or tightening a
rule, to find pre-existing violations the gate wouldn't surface. An explicit path/dir/glob
argument lints exactly that, ignoring the changed-set filter:

```bash
npm run lint:skills -w tools/skill-lint -- .claude/skills/showboat        # one skill by dir
npm run lint:skills -w tools/skill-lint -- '.claude/skills/*/SKILL.md'    # explicit glob
```

The changed set is the diff vs the first existing trunk ref (`origin/main`, `main`, …),
computed against the **working tree** so a staged-but-uncommitted skill still counts at
pre-commit. When the diff **can't** be computed — no git, or a shallow checkout with no trunk
ref (as in CI) — the gate **lints everything** rather than silently skip, so CI stays a full
sweep. `--help` prints usage.

## The rules

Each rule maps to a piece of `skill-creator` guidance. Severity decides whether it
**fails** the lint (errors → exit 1) or is merely **advisory** (warnings never fail it).

| Rule | Severity | Fires when | Fix |
| --- | --- | --- | --- |
| `description-length` | error | the frontmatter `description` exceeds ~1024 chars (the listing budget Claude sees) | tighten it — lead with what-it-does + distinctive keywords in the first ~250 chars, drop redundant scope |
| `description-tightness` | warn | the `description` is under the cap but past the ~700-char soft target | re-check it for smuggled-in content — rule details, implied context, extra scope — and state the subject + triggers, not the body's guidance |
| `description-no-repo-name` | error | the frontmatter `description` names the repo (matches `/alfred/i`) | drop it — the agent already knows the repo from CLAUDE.md, so it's redundant scope that wastes the front-loaded triggering budget; disambiguate *which part* with "the frontend" / "the monorepo" if needed |
| `body-length` | warn | the SKILL.md body runs past ~500 lines | add a layer of hierarchy and move detail into `references/` that loads on demand |
| `compound-toc` | error | a **compound** skill (it bundles a `scripts/`, `references/`, `assets/`, … directory) has no `## Contents` / `## Table of Contents` section among its first two top-level sections | add a Table of Contents near the top that lists the body sections and links the bundled resources |

A skill is **compound** when its directory contains any subdirectory — that's the signal
it has bundled resources a reader of SKILL.md must discover for progressive disclosure to
work, which is why the TOC is required there and not for a single-file skill.

## Reading and fixing findings

A finding prints as `<icon> <severity> [<rule>]<:line> <message>`, grouped by file, with a
summary tally at the end:

```
.claude/skills/supabase/SKILL.md
  ✗ error [compound-toc] compound skill (bundles references/) has no Table of Contents. …

skill-lint: 25 skill(s), 1 error(s), 0 warning(s).
```

Fix findings **in the skill**, never by loosening the linter — that's the same
back-pressure rule that governs ESLint here. A finding is the linter doing its job; the
message tells you the concrete move. Errors must be cleared before the commit gate
passes; warnings are signals you can act on when it makes sense.

## Everyday gotchas

- **Warnings don't fail the gate.** A `body-length` warning on a legitimately large skill
  (e.g. `skill-creator`) is informational — `check:fast` still passes. Only errors block.
- **The gate only lints the skills you changed.** A pre-existing error or warning in an
  untouched skill won't surface at `check:fast` — that's deliberate (no noise from the rest of
  the library). After adding or tightening a rule, run `npm run audit:skills` to sweep the
  whole library and fix what the gate wouldn't show. A brand-new skill that's never been
  staged is untracked, so it won't appear in the diff either — `git add` it (or audit) to lint
  it.
- **The compound-TOC "appropriate spot" is the top.** The TOC must be a top-level `##`
  section that appears **first or second** in the body, so a reader meets the bundled
  resources before the deep content. A `### Contents` buried mid-document still fails.
- **Headings inside code fences are ignored.** A `# comment` in a ` ```bash ` block is not
  counted as a heading, so it won't satisfy (or trip) the TOC rule.
- **Descriptions are measured folded.** A YAML block scalar (`description: >`) is folded
  to a single space-joined string before the length check — what you measure is what the
  model sees, so wrapping a long description across lines doesn't dodge the cap.
- **Skill markdown isn't auto-formatted.** No package formats `.claude/skills/*.md`, so the
  TOC you write is the TOC that ships — keep its anchors and links correct by hand.

For the architecture, adding a rule, the thresholds, the `check:fast` wiring, and the
source-maintenance gotchas, see
[`references/extending-and-wiring.md`](./references/extending-and-wiring.md).
