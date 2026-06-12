---
name: compounding-learning
description: >
  Guides how to record and maintain compounding-learning updates to alfred's `.claude/skills/` library. Read BEFORE writing or editing any SKILL.md — whenever resolving a non-obvious problem, or when correcting a previous skill edit. Covers what belongs in the main skill body vs references/, the format rules that keep skills lean and trustworthy, and the anti-patterns that corrupt them. Also governs self-improvement: when a skill correction is made, document the example in this skill's references. Trigger on: "update the skill", "record this gotcha", "add to the skill", "note in the skill", editing a SKILL.md file, or any wrap-up step that involves skill maintenance.
---

# Compounding Learning

Skills are shared, permanent memory for the whole agent swarm. A bad edit doesn't just waste space — it misleads every future agent that reads the skill. The goal: **each problem is encountered at most once**, and every skill stays lean enough to read in full and trust every word.

## When to record

After hitting and resolving a non-obvious problem, record it **before moving on**:

- Framework/library problem → update that framework's existing skill
- Anything else (service quirk, CLI, config, workflow) → find the skill for that area of concern, or create one if none exists

"It was just a one-off" is the rationalization to resist. If it cost discovery time and could recur, it is a skill.

## What to record — and where

**Main skill body** — things relevant basically every time the skill is used: recurring gotchas, project conventions that override defaults, decision rationale an agent would otherwise re-litigate.

**`references/`** — things needed only occasionally: one-time setup and wiring details, scaffolding gotchas, large config templates, anything an agent doing routine work in this area will rarely encounter.

The test: *if an agent is doing ordinary work in this area, will they hit this situation?* Yes → main body. Rarely → reference.

When promoting content to a reference, add a one-line pointer in the skill body so it's discoverable without reading the whole reference file.

## Format rules

**No meta-content.** The skill is a reference, not a changelog. Never include:
- Origin notes ("Ported from…", "Added when we…", "Folded in from…")
- Historical context about past decisions that are no longer active ("Previously alfred used X — this was changed because…")
- Supersession markers calling out old content as obsolete ("The §8 note is now obsolete")

**Remove contradicted content.** When an update makes an existing section wrong or irrelevant, delete that section. Don't note that it's obsolete — just fix it and move on.

**One gotcha, one bullet.** State the problem and the fix. Skip the rationale unless it's genuinely non-obvious; agents are smart enough to trust correct instructions without a paragraph of justification.

**No duplication.** A gotcha belongs to exactly one skill. Put it where an agent will read it together with the relevant code; don't copy it elsewhere.

## Self-improvement

When told to make a correction to a skill edit — whether the feedback came from the user or a review — document the example before closing the task:

1. Identify which anti-pattern category it falls into (see [`references/anti-patterns.md`](references/anti-patterns.md))
2. Add a concise example under that heading: one-line description of what was wrong, the before snippet, and the after snippet

This is how the anti-patterns reference grows without anyone having to remember to maintain it.

## References

- [`references/anti-patterns.md`](references/anti-patterns.md) — grouped catalog of real before/after examples from this repo's history. Read the relevant section when unsure whether a particular update is right.

To locate the relevant anti-pattern:
```bash
grep -i "<keyword>" .claude/skills/compounding-learning/references/anti-patterns.md
```
