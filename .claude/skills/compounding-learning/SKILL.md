---
name: compounding-learning
description: Covers the house style for recording a compounding-learning insight into a skill. Read this BEFORE adding a gotcha or insight to any SKILL.md or reference file — i.e. whenever the CLAUDE.md compounding-learning rule fires because you hit and resolved a setback or non-obvious problem at any stage (feature work, commit, push, PR, deploy). Also read it when revising or correcting how an insight was recorded, and capture that correction here as a before/after example. Trigger on: "record this gotcha", "update the X skill", "add this to the skill", "capture this insight", "note this for next time", "compounding learning", or any edit to a file under .claude/skills/.
---

# Compounding Learning

Agent knowledge is a durable, compounding asset. Back-pressure (the deterministic
suites) prevents regressions mechanically; **skills prevent _repeated discovery
cost_** — the price of re-learning the same gotcha. This skill is the house style for
keeping that knowledge layer healthy. The goal is simple: **each problem is
encountered at most once** — across the whole swarm and across sessions.

The skill library lives in `.claude/skills/` — one `SKILL.md` per **area of
concern**: app frameworks (Next.js, React, Tailwind, Supabase, Cloudflare Workers,
the Anthropic API, Jest, Storybook, Playwright, …) *and* the developer tooling and
CLI workflows the swarm leans on (git, `gh`, `vercel`, `wrangler`, `supabase`,
`psql`, husky, CI). A reproducible quirk in any of those is just as skill-worthy as a
framework gotcha.

## Where the insight goes

1. **Tied to a specific framework, library, service, CLI, or tool** → update that
   tool's skill (e.g. Next.js, Supabase, Playwright, `gh`, `wrangler`).
2. **Not tied to any one tool** — a cross-cutting project convention, house-style
   decision, or architectural pattern → it belongs in a house-style skill like
   `data-flow` or `motion`. Update the one for that area of concern, or **create it
   if none fits**.

## Improving this skill

This skill compounds the same way the others do. **When you're told to revise or
correct an edit you made to a SKILL** — a human or reviewer pushes back on *how* you
recorded an insight (too verbose, wrong altitude, left stale text, duplicated
something) — that correction is itself a compounding-learning lesson. Before moving on,
capture it: add a short **before/after** entry to the matching `references/` file
(create a new theme file, and link it in the worked-examples table below, if none fits).
Keep entries faithful — quote the real text, trimmed to the essentials — and follow the
very rules this skill teaches: lean, current, no archaeology about the correction itself.

## Principles (read every time)

Recording is good and we do it consistently — that's not the problem. The problem is
*how*: edits that bloat, restate, narrate, or go stale. The principles below are the
fix; consult the matching reference for worked before/after examples when an edit isn't
obviously clean.

1. **A skill is current truth, not a changelog.** Write the insight as if it had
   always been there. Never narrate the edit — no "ported from the main SKILL.md",
   "Extracted from…", "folded in from…", "supersedes §8", "Historical note: we used
   to…". When a change *contradicts* existing text, **delete the old text** — don't
   annotate it as obsolete and leave it sitting there. Stale or invalidated sections
   must be trimmed out, not flagged. → `references/no-archaeology.md`

2. **Less is more — there is no minimum length.** A point that fits in one sentence
   gets one sentence. Don't spend a paragraph re-justifying a rule the preceding line
   already states, and don't pad a gotcha with derivations. Unnecessary prose pollutes
   context and costs tokens on every load. → `references/keep-it-lean.md`

3. **Right altitude — body vs. reference.** The always-loaded body holds only what's
   relevant **basically every time** the skill is used. One-time setup gotchas, rarely
   hit edge cases, and long config listings belong in a `references/` file linked from
   a **table of contents at the top of the body**, so an agent discloses them only when
   the situation calls for it. Don't bury the common case behind a rarely-needed
   section. → `references/right-altitude.md`

4. **Single source of truth.** Don't restate what CLAUDE.md, another skill, or a
   **deterministic guardrail** (lint / type-check / test) already provides. A gotcha
   lives in **exactly one** skill — cross-reference it, don't copy it (copies drift) —
   and a mechanically-enforced rule lives in the gate, not in "follow rule X" prose.
   **The exception is discovery cost:** when a guardrail throws a *cryptic error whose
   fix is non-obvious*, record the fix (e.g. a "common gotchas" entry in that guardrail's
   skill) so it isn't re-derived every time. → `references/single-source-of-truth.md`

5. **One focused, validated change.** Record an insight you've actually confirmed, not
   a guess you'll rewrite tomorrow. Keep each recording to one tightly-related concern
   rather than a multi-skill grab-bag that hides low-value items among good ones. →
   `references/focused-changes.md`

## Worked examples (consult as needed)

Each reference is a small before/after library mined from real corrections in this
repo. Open the one that matches the edit you're about to make — or that a reviewer just
pushed back on. They grow over time (see "Improving this skill" above), so grep for a
keyword rather than reading end to end.

| Read when your edit risks… | Reference | grep for |
| --- | --- | --- |
| narrating the change, or leaving contradicted/stale text in place | `references/no-archaeology.md` | `grep -i "supersedes\|historical\|extracted" references/no-archaeology.md` |
| padding a one-line point into a paragraph | `references/keep-it-lean.md` | `grep -i "verbose\|paragraph" references/keep-it-lean.md` |
| putting a rarely-needed / setup gotcha in the always-loaded body | `references/right-altitude.md` | `grep -i "setup\|reference\|toc" references/right-altitude.md` |
| repeating CLAUDE.md or another skill | `references/single-source-of-truth.md` | `grep -i "duplicate\|cross-ref" references/single-source-of-truth.md` |
| a grab-bag commit or premature, soon-rewritten guidance | `references/focused-changes.md` | `grep -i "grab-bag\|churn" references/focused-changes.md` |
