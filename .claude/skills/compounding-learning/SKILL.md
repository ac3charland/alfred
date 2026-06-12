---
name: compounding-learning
description: >
  Describes how to record a resolved setback or non-obvious insight into the skill
  library — the compounding-learning rule: which skill owns the insight (update vs
  create), whether it belongs in the SKILL.md body or a references/ file, and the house
  style for skill edits, backed by a catalog of real corrections. Read BEFORE writing or
  editing any SKILL.md or skill reference doc under .claude/skills/. Trigger on: "record
  a gotcha", "add this to the skill", "update the skill", "lesson learned", "create a
  skill", a code or tooling change that invalidates existing skill content, or being
  asked to fix, polish, trim, or revert a previous skill edit (that correction must also
  be captured in this skill's catalog). For frontmatter, descriptions, and trigger
  optimization, pair with the skill-creator skill.
---

# Compounding learning — recording insights so they compound

The library's goal: **each problem is encountered at most once** — across the
whole swarm and across sessions. That only works if recorded insights stay
**true, lean, and findable**. Experience so far: agents record gotchas
reliably; what needs steering is *how* the record is written. This skill is
the difference between an edit that compounds and one that becomes someone's
cleanup work.

## Contents

**This file**

- [When to record](#when-to-record)
- [Where the insight goes](#where-the-insight-goes)
- [House style — the principles](#house-style--the-principles)
- [The correction catalog](#the-correction-catalog)
- [Improving this skill itself](#improving-this-skill-itself)

**References** — real corrections, grouped by scenario; read the one that matches yours

- [`references/recording-insights.md`](references/recording-insights.md) — you're adding a new gotcha / insight to a skill (what good looks like, verbosity, wrong-skill placement)
- [`references/updating-after-change.md`](references/updating-after-change.md) — your change invalidates something a skill currently says (meta-comments, stale and contradicted content)
- [`references/structure-and-layout.md`](references/structure-and-layout.md) — you're deciding where content lives (setup-only gotchas in the body, missing Contents index, section order)

## When to record

You hit and resolved a setback or **non-obvious** problem — at *any* stage,
including the commit → push → PR → deploy wrap-up, not just while writing
feature code. Record the insight **before moving on, the same turn**, without
being asked. "It was just a one-off CLI hiccup" / "a quick workaround" is
exactly the rationalization to resist: if it cost discovery time and could
recur, it's a skill.

The bar is **non-obvious**: record what cost real discovery time, not what the
next agent would get right anyway or what the gate's own error message already
explains.

## Where the insight goes

One `SKILL.md` per **area of concern** — app frameworks (Next.js, React,
Tailwind, shadcn/ui, Supabase, Cloudflare Workers, Anthropic API, Jest, RTL,
Storybook, Playwright, ESLint, commitlint, npm workspaces, TypeScript, …) and
equally the **developer tooling and CLI workflows** the swarm leans on (git,
`gh`, `vercel`, `wrangler`, `supabase`, `psql`, husky, CI steps).

1. **Framework / library-related** → that framework's existing skill.
2. **Anything else** — a service quirk, an integration, a config interaction,
   a piece of functionality, a tooling/CLI/workflow gotcha → the existing
   skill for that area of concern; **if none exists, create one** (read the
   skill-creator skill for authoring mechanics and the description playbook).

Two routing rules that have needed correction in practice:

- **The owning skill, not the open one.** Route by what the insight is
  *about*, not by which skill you happened to be working from. A
  Storybook-stories convention belongs in the storybook skill even if you hit
  it while writing an RTL test.
- **Exactly one home.** If another skill's readers also need it, cross-link
  ("see the storybook skill") — don't restate it there. Duplicates drift.

Skills are alfred-specific even when named for a library: `react` or
`supabase` blends the library's reference with this project's conventions, so
project context goes straight into the relevant skill — never a separate
"alfred notes" skill.

## House style — the principles

Every correction in the catalog reduces to one of these. They apply to every
skill edit, every time:

1. **Write the skill as if it had always known this.** Never narrate the
   edit: no provenance ("ported from the main SKILL.md", "folded in from X"),
   no changelog ("supersedes §8", "we now do Y instead"), no history ("alfred
   once did Z"). The reader needs current truth, not how it got there.
2. **A change that invalidates text deletes or rewrites that text.** Never
   leave the stale statement standing, and never append the correction beside
   it — make the statement itself true. Then grep the *other* skills for the
   same now-false fact.
3. **When the cause is gone, the warning goes too.** A gotcha whose trigger
   no longer exists (rule disabled, approach retired) is dead weight — remove
   it entirely, including any "last resort" or "historical note" residue.
4. **The body is for every-time; `references/` is for sometimes.** One-time
   setup, wiring, maintenance, and rare-scenario material goes in a reference
   doc, linked from a Contents section at the top of SKILL.md. Keep the body
   lean — unneeded context pollutes and confuses.
5. **No minimum length.** A complete insight is symptom → cause → fix, and
   two sentences often cover it. Skip generic preamble; one clause of "why"
   is enough when the rule is already legible.
6. **Record only what's real here.** Don't document hypothetical
   configurations the project doesn't have, and never record a workaround
   that dodges a guardrail — the real resolution is a deliberate config
   change or a note in `docs/lint-suggestions/` (see CLAUDE.md), and *that
   decision* is what the skill documents.

## The correction catalog

Before making the edit, open the reference matching your scenario (the
Contents list above routes them). Each file is an anti-pattern catalog from
this repo's history: `##` groups named for the anti-pattern, and under each,
`### Example:` cases — a one-line description of what went wrong, then the
**Before:**/**After:** that fixed it. Grep a keyword (e.g.
`grep -ril "table" .claude/skills/compounding-learning/references/`) to land
on the relevant case without reading everything.

## Improving this skill itself

The catalog grows the same way every other skill does. **When the user
corrects a skill edit** — asks you to change, trim, restructure, or revert
something you or a previous agent wrote into a SKILL.md or reference doc —
that correction is itself a compounding-learning event:

1. Apply the correction.
2. **Same turn**, add an `### Example:` case under the matching anti-pattern
   group in the right `references/` file: a one-line description of what went
   wrong, then **Before:**/**After:** in fenced blocks (quote the essential
   lines, elide the rest; when the fix is a deletion, say so in prose).
3. No matching group? Add a new `##` group with a one-line definition — or a
   new reference file — and route it from the file's Contents and the list
   above.
4. If the correction reveals a genuinely new principle, add it to *House
   style* as one numbered line; the example carries the detail.

The same applies when you catch *yourself* about to violate a principle in a
new way: a near-miss that took a re-read to catch is worth an example.
