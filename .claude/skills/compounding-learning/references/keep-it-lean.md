# Keep it lean — there is no minimum length

A tweak to a skill has no quota. A point that fits in one sentence gets one sentence.
The instinct to "write it up properly" produces justifying paragraphs, restated
derivations, and bolded preambles that the surrounding text already implies. Every
extra line loads on every future invocation, so verbosity is a recurring tax, not a
one-time style nit.

## Contents

- A "Why:" paragraph re-justifying the line above it (skill-creator)
- A derivation spelled out before the point (batch-commits)
- A generic preamble in front of the specific gotcha (playwright)
- A redundant forward-pointer (showboat)
- Over-stuffed table cells (eslint)

## A "Why:" paragraph re-justifying the line above it — skill-creator (`5f1b0ab`)

The rule sentence ("bundled scripts must be self-contained") was clear. A full "Why:"
paragraph restated it at length.

BEFORE:
```
Why: a skill is a portable, droppable unit. The moment running it requires an edit to
the host repo's config, the skill stops being self-contained — it won't work when the
skill is copied to another repo ... reaching back into the host project for it.
```
AFTER: *(paragraph removed; the rule ends at "...pointing the agent at that command).")*

**Lesson:** explaining *why* is good when the why is non-obvious — but don't re-explain
a rule the reader already understood from the sentence before.

## A derivation spelled out before the point — batch-commits (`eeed80a`)

BEFORE:
```
Here's the key insight: in the documented flow you **finish the work, get `check`
green, then split the finished diff into logical commits**. At that point every commit
is made against the *same* final working tree ... **N−1 of them are pure redundancy.**
```
AFTER:
```
When committing by logical concern, this means `check:fast` is run multiple redundant
times for the same set of changes.
```

**Lesson:** state the consequence; skip the proof. The reader doesn't need to be walked
through the N-vs-N−1 reasoning to act on "it runs redundantly."

## A generic preamble in front of the specific gotcha — playwright (`ecbcd0b`)

A bolded lead-in restated something already obvious from context before reaching the
alfred-specific substance.

BEFORE:
```
**The `webServer` must be able to boot, or every E2E times out with `Timed out waiting
Nms from config.webServer`.** In alfred ... the Supabase client constructor *throws at
startup* when ...
```
AFTER:
```
The Supabase client constructor *throws at startup* when `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent ...
```

**Lesson:** lead with the part only this skill can tell you. Generic framing is filler.

## A redundant forward-pointer — showboat (`17a61ea`)

The same sentence already pointed the reader where to go; a trailing "see below" pointed
there again.

BEFORE:
```
description (see *Linking the demo in the PR* below). For a **visual** change, the
centrepiece is a screenshot instead — see below.
```
AFTER:
```
description (see *Linking the demo in the PR* below).
```

## Over-stuffed table cells — eslint (`0ad8139`)

Quick-reference table rows had grown into multi-clause how-tos that belonged in prose
(or another skill). Removing them kept the table scannable. **Lesson:** a reference
table is an index, not the content — if a cell needs a paragraph, it's in the wrong
shape.
