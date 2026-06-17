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
- A one-idea rule inflated into a multi-paragraph section (implement-spec)

## A "Why:" paragraph re-justifying the line above it — skill-creator (`5f1b0ab`)

The rule was already stated plainly; the "Why:" paragraph that followed just restated it.

BEFORE:
```
…**don't** wire a script into the host project (e.g. adding an `npm run foo` entry to
the repo's `package.json` and pointing the agent at that command).

Why: a skill is a portable, droppable unit. The moment running it requires an edit to
the host repo's config, the skill stops being self-contained — it won't work when the
skill is copied to another repo ... reaching back into the host project for it.
```
AFTER:
```
…**don't** wire a script into the host project (e.g. adding an `npm run foo` entry to
the repo's `package.json` and pointing the agent at that command).
```

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

## A trailing "why" sentence after an already-clear imperative — showboat

A new rule was stated clearly; a trailing sentence re-explained it from a different angle,
adding nothing the rule didn't already imply.

BEFORE:
```
**When the change is purely an animation (the before/after states are visually identical
stills), the GIF alone is the evidence — do not add before/after screenshots.** Static
shots of the same frozen UI add file size without showing the change.
```
AFTER:
```
**When the change is purely an animation, the GIF alone is the evidence — do not add
before/after screenshots.**
```

**Lesson:** drop the "why" when the rule already implies it. Also drop parentheticals that
spell out what the adjoining word already says ("purely" = no stills needed, no need to
define it).

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

## A one-idea rule inflated into a multi-paragraph section — implement-spec

One rule — "don't carry spec-only references into the code" — was spread across a standalone
sentence restating it plus three labelled, near-identical before/after examples.

BEFORE:
```
**Translate the meaning into self-contained prose instead.** If the section was saying
something worth keeping, say *that thing*; if the sentence already stands on its own, just
drop the citation.

**Example 1** — drop a citation… **Example 2** — keep the meaning… **Example 3** — a
comment that only pointed at the spec…   [three Before/After pairs]
```
AFTER:
```
Translate the meaning into self-contained prose, or drop the citation when the sentence
already stands alone:

- `… deep links (§11).` → `… deep links.`
- `the ToS-clean human launch (§1/§11.1)` → `… — prefilled, never auto-submitted`
```

**Lesson:** a rule that fits in a sentence needs one or two examples, not three labelled ones
plus a paragraph re-stating the rule. Fold the restatement into the rule, and keep only the
examples that show *distinct* cases (drop vs. translate) — cut the duplicates.
