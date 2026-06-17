# skill-lint `description-no-repo-name` — wrong for a skill deployed to *other* repos

**Rule(s):** `skill-lint/description-no-repo-name` (regex `/alfred/i` over the description)
**Package / scope:** `tools/skill-lint`, applied to `.claude/skills/*/SKILL.md`
**Date / branch:** 2026-06-16 · claude/refinement-prompt-agentic-review-lbcfwx

## What happened
Authoring `.claude/skills/refinement/SKILL.md` — a skill that is **copied into each project
repo** and read during an alfred refinement session. The natural description names "alfred"
(it triggers on "alfred refinement session", "the alfred frontmatter block", etc.), which the
rule rejects:

```
✗ error [description-no-repo-name] description names the repo ("alfred"). The agent already
  knows which repo it's in (CLAUDE.md), so drop it — it wastes the front-loaded triggering budget.
```

## Why the rule doesn't fit here
The rule's premise is "the agent already knows which repo it's in." That holds for skills that
live and run **only** in this repo. The refinement skill is the opposite: it's deployed into
*other* repos, where "alfred" is not the current repo — it's meaningful external-domain context
(the system the refinement workflow serves). There, "alfred" is informative, not redundant.

## Suggested change
Exempt skills that are portable-by-design — e.g. an opt-out via a marker in the SKILL.md
frontmatter (`portable: true`) that suppresses `description-no-repo-name` for that file, or a
small allowlist of skill names (`refinement`). The repo-name check stays on for every
in-repo-only skill.

## Workaround used meanwhile
Worded the refinement skill's description with **no** "alfred" — generic refinement-session
language ("refine the ticket", "refinement session", "spec-only PR"). The body (not linted for
the repo name) still carries the alfred-specific detail.

## Workarounds to rip out if the rule changes
- [ ] `.claude/skills/refinement/SKILL.md` — once the rule exempts portable skills, the
  description may name "alfred" directly (e.g. "an alfred refinement session", "the `alfred`
  PR block") for sharper triggering in target repos.
