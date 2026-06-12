# Single source of truth — don't restate, don't copy

A fact lives in exactly one place. Two copies drift: one gets updated, the other
silently goes wrong. Before recording, ask "does CLAUDE.md or another skill already say
this?" If yes, link to it or leave it there — don't restate it.

- **Don't restate CLAUDE.md.** The operating rules (back-pressure, the workflow, the
  generated-files policy) are already loaded. Repeating them in a skill adds nothing.
- **A gotcha belongs to one skill — the one for its area of concern.** Cross-reference
  it from a related skill ("see the eslint skill"); don't paste the content into both.

## Contents

- The same sentinel copied into two skills (react-testing-library + supabase)
- Restating a rule CLAUDE.md already owns (stryker `.prettierignore`)
- A how-to that belongs to another skill (react-testing-library, eslint)
- A convention echoed across two skills (cloudflare-workers + eslint)

## The same sentinel copied into two skills — RTL + supabase (`22088bd`, `145d299`)

The `const DB_NULL = undefined as unknown as null` workaround was added to
**react-testing-library** (`22088bd`) *and* independently to **supabase** (`145d299`).
Same fix, two homes, neither linking the other — so when the underlying lint rule was
later disabled, both copies had to be found and removed separately.

**Lesson:** a Supabase query gotcha belongs in the **supabase** skill, full stop. If RTL
tests need to know about it, RTL cross-references supabase — it doesn't carry its own
copy.

## Restating a rule CLAUDE.md already owns — stryker (`068bf70`)

A bullet told the reader to add Stryker artifacts to each package's `.prettierignore` —
which is just the **generated-files-are-excluded** rule CLAUDE.md already states (and
which the skill's own "generated report" bullet right below it also covered).

**Lesson:** if the instruction is a special case of a CLAUDE.md rule, don't re-derive
the rule in a skill. Point at it if anything.

## A how-to that belongs to another skill — RTL (`ded844f`)

A "Storybook stories with required callback props" note about an ESLint exception was
parked in the **react-testing-library** skill, where it had no business — it's a
storybook/eslint concern.

BEFORE (in the RTL skill):
```
**Storybook stories with required callback props**
Stories need inert no-op props ... The project scopes
`@typescript-eslint/no-empty-function` **off** ...
```
AFTER: *(removed from RTL; the topic is owned by the storybook/eslint skills)*

**Lesson:** record a gotcha under its *area of concern*, not under whichever skill you
happened to be using when you hit it.

## A convention echoed across two skills — cloudflare-workers + eslint (`7a25717`)

Documenting the `_`-prefix unused-var convention, the same point was stated in the
**eslint** skill (which owns lint conventions) *and* echoed in **cloudflare-workers**.

**Lesson:** one skill owns the convention; the other, at most, cross-references. Echoing
the full statement in both is duplication waiting to drift.
