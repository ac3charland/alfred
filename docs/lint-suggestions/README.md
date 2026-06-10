# Lint-suggestion inbox

When a lint rule — or a *combination* of rules — fights you in a context where it
genuinely doesn't make sense, **don't silently work around it.** The back-pressure
hard rules in [`CLAUDE.md`](../../CLAUDE.md) still hold: no `eslint-disable`, no
`@ts-expect-error`, no weakening tooling config as a reaction to a red check, no
`--no-verify`.

Instead, **file a suggestion here, then proceed**:

1. **Make your code pass the gate as it currently stands.** The inbox is a
   parallel channel — it never blocks the commit, and it is never an excuse to
   bypass a check.
2. **Add one markdown file per issue** to this directory, named for the problem
   (e.g. `no-empty-function-in-stories.md`). Use the template below.
3. **Do this before moving on**, the same turn you hit the friction — like the
   compounding-learning rule for skills, the goal is that each rough edge is
   surfaced exactly once.

A human (or the lead) reviews the inbox and decides whether to change the rule.
If a suggestion is accepted and the rule is changed, delete its file — the inbox
holds only *open* suggestions. (Two changes this repo already made — `_`-prefixed
unused vars, and empty stubs in Storybook stories — came from exactly this kind of
friction.)

This is the sanctioned alternative to an ad-hoc bypass: it keeps the guardrails
intact while still routing real friction toward a deliberate, reviewed decision.

---

## Template

Copy this into a new `docs/lint-suggestions/<short-slug>.md`:

```markdown
# <rule or combination> — <one-line summary>

**Rule(s):** `plugin/rule-name` (+ any interacting rules / tsconfig flags)
**Package / scope:** frontend | workers | both — and the file glob if narrower
**Date / branch:** YYYY-MM-DD · branch-name

## What happened
The concrete code you were writing and the error(s) it produced. Paste the exact
lint message.

## Why the rule doesn't fit here
Explain why the rule is wrong *in this context* (not "I find it annoying"). Note
any rule combination or config interaction that creates a dead end.

## Suggested change
A concrete proposal — e.g. the rule options to set, or a `files`-scoped override —
and which packages it should apply to. Include the snippet if you can.

## Workaround used meanwhile
What you did to pass the gate in the current code, so the reviewer can see the
cost the rule is imposing.
```
