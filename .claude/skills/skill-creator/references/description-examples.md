# Description before/after library

A growing set of real description fixes — each a concrete *before → after* with the smell it
cures. Read it when **writing or editing any skill description**: skim for the smell your
draft might have, then check your draft against the matching pair. The *rules* and their
*reasoning* live in [`description-triggering.md`](description-triggering.md); this file is the
worked examples, so don't restate the theory here — add a pair.

grep for a smell: `grep -iE 'inlines|repo name|enumerates|buried' description-examples.md`

## Inlines the skill's content (especially at the front)

A description says *what the skill covers and when to reach for it* — not the skill's actual
guidance. Spelling out the rules reproduces the body, drifts from it, and burns the
front-loaded triggering budget. Name the subject; stop there.

❌ **Before** (`backpressure`):
> Documents how the deterministic checks (the back-pressure gates) are wired — where a check
> belongs and which tier runs it. **A package's own typecheck/lint/format/test lives in that
> workspace's check:fast/check:slow; a monorepo-wide check (linting all of .claude/skills/ or
> docs/demos/) lives in the root check command. Covers the pre-commit (fast) vs pre-push
> (slow) tier choice.** Use when adding or moving a check…

✅ **After** — cut the bolded sentences; the framing ("where a new check belongs and which tier
runs it") already names the subject, and the body holds the answer:
> Documents how the deterministic checks (the back-pressure gates) are wired — where a new
> check belongs and which tier runs it. Use when adding or moving a check, linter, or gate…

The tell: if a sentence would answer "*how does the skill say to do it?*", it's body content.
Subject-naming answers "*what is this about?*" instead.

## Enumerates every rule/item the skill contains

A variant of inlining: listing each rule, command, or option turns the description into a
table of contents and forces a re-edit every time the skill grows. State the *kind* of thing
it covers.

❌ **Before** (`skill-lint`):
> …runs inside check:fast. **Four rules ship today: a description-length error (the
> ~1024-char cap), a description-no-repo-name error (a description must not name the repo), a
> body-length warning (over ~500 lines), and a compound-TOC error…**

✅ **After** — describe what it flags, not each rule:
> …runs inside check:fast — flagging descriptions that exceed the char cap, run long/verbose,
> or name the repo, bodies past ~500 lines, and compound skills missing a Table of Contents.

## Names the repo (redundant scope)

The agent already knows which repo it's in (CLAUDE.md), so the repo name is wasted scope in
the highest-value position — and `skill-lint`'s `description-no-repo-name` rule now errors on
it. Drop it, or disambiguate *which part* with "the frontend" / "the monorepo".

❌ **Before** → ✅ **After**:
- `dnd-kit`: "Covers dnd-kit drag-and-drop **in alfred's frontend**" → "…**in the frontend**"
- `batch-commits`: "the only sanctioned use of --no-verify **in alfred**" → "…**in the repo**"
- `git`: "Covers git CLI workflows **in alfred**" → "…**in the monorepo**"
