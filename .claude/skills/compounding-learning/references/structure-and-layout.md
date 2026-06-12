# Skill structure & layout — corrections catalog

How a skill's content is arranged: what stays in the SKILL.md body, what moves
to `references/`, and how readers find it. The recurring correction: bodies
drift toward "everything we know" when they should be "what you need every
time."

## Contents

- [The target shape](#the-target-shape)
- [Setup and maintenance material moves to references/](#setup-and-maintenance-material-moves-to-references)
- [A Contents section at the top — sections and references](#a-contents-section-at-the-top--sections-and-references)
- [Order sections by how often they're needed](#order-sections-by-how-often-theyre-needed)
- [A reference doc opens with what it holds and when to reach for it](#a-reference-doc-opens-with-what-it-holds-and-when-to-reach-for-it)
- [Compress while you restructure](#compress-while-you-restructure)

## The target shape

```
skill-name/
├── SKILL.md            # every-time guidance + a Contents section routing to the rest
└── references/
    ├── <topic>.md      # setup, wiring, maintenance, rare scenarios
    └── …
```

The SKILL.md body loads on every trigger; references load only when needed.
The test for body residency: **would an agent doing routine work in this area
need this almost every time?** If not, it's reference material.

## Setup and maintenance material moves to references/

The playwright skill's body had accumulated the full `playwright.config.ts`
reference, the `auth.setup.ts` wiring, the Storybook test-runner browser
config, and a "gotchas hit wiring this up" list — none of it needed for
everyday test authoring. All of it moved to
`references/setup-and-wiring.md`, leaving the body to locators, assertions,
and the mock-backend model that every spec touches.

The batch-commits skill got the same treatment: "Edge cases & failure modes"
and "Maintaining the tool" moved to `references/failure-modes.md` and
`references/maintenance-gotchas.md`, linked from a closing section:

> ## Further Reading
>
> - Getting unexpected output? See [failure-modes.md](./references/failure-modes.md)
> - Updating/maintaining the tool? See [maintenance-gotchas.md](./references/maintenance-gotchas.md)

**Principle:** a gotcha that only fires during setup, maintenance, or another
rare scenario is still worth recording — in a reference doc. The body answers
"what do I need right now, every time."

## A Contents section at the top — sections and references

Manual polishes added a Contents block at the top of both the playwright and
batch-commits skills, listing the body's sections *and* the bundled
references/scripts, each reference with a one-line "when to read" note:

> **References**
>
> - [`references/setup-and-wiring.md`](references/setup-and-wiring.md) —
>   `playwright.config.ts` / `auth.setup.ts` reference, Storybook test-runner browser
>   config, and gotchas hit wiring the integration suite

**Principle:** the Contents section is the progressive-disclosure index — a
partial read of SKILL.md still reveals everything the skill can answer and
where to find it. Any skill with reference docs needs one, and a new reference
doc isn't done until it's listed there.

## Order sections by how often they're needed

A polish of the playwright skill moved "Mocking the backend" (relevant to
every spec) above "Browser availability: Claude Code on the web" (a
sandbox-provisioning concern). The latter had sat higher purely because it was
written first.

**Principle:** position signals priority. Place a new section where its usage
frequency puts it — not at the bottom (or top) by default.

## A reference doc opens with what it holds and when to reach for it

The corrected intro of the playwright setup reference:

> This holds the **one-time setup material and the gotchas hit wiring the suite up** —
> the `playwright.config.ts` / `auth.setup.ts` reference, the Storybook test-runner
> browser config, and the integration-suite wiring gotchas. You rarely need any of this
> for everyday test authoring; reach for it when scaffolding the suite, editing config,
> or debugging a setup-level failure.

**Principle:** the first lines of a reference doc let a partially-reading
agent decide whether to keep going: contents of this file + when you need it.
No provenance (see
[updating-after-change.md](updating-after-change.md#no-provenance-or-changelog-narration)).

## Compress while you restructure

The batch-commits intro spent three paragraphs ("Here's the key insight: …")
deriving why N gate runs on one finished tree are redundant. The polish kept
only the conclusion:

> The `pre-commit` hook runs root `check:fast` (typecheck → `eslint --fix` →
> `prettier --write` → unit tests) on **every** commit. When committing by logical
> concern, this means `check:fast` is run multiple redundant times for the same set of
> changes.
>
> This script addresses the problem by running that check **exactly once** and creating
> all the commits:

**Principle:** restructuring is the moment to re-justify every sentence. If a
paragraph exists to convince rather than instruct, keep the conclusion and
drop the proof.
