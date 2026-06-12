# Focused, validated changes

Two related habits keep recordings trustworthy: **record one tightly-related concern at
a time**, and **record only what you've confirmed**. A multi-skill grab-bag hides
low-value items among good ones and grows several bodies in lumps; a premature recording
becomes guidance the next agent follows before you rewrite it.

## Contents

- The grab-bag commit (eslint + playwright + rtl)
- Churn: guidance recorded, then rewritten days later (story stubs)

## The grab-bag commit — eslint + playwright + RTL (`22088bd`, `145d299`)

Each of these touched three skills with loosely-related gotchas under one vague "record
X and Y gotchas" message. The bundling let genuinely niche items ride along unnoticed —
e.g. a `unicorn` circular-constraint escape with a full insertion-sort code block in the
always-loaded body:

```
When you have both `unicorn/no-array-sort` ... AND `unicorn/no-array-reduce` ... and
`tsconfig` targets ES2022 ... you get a circular constraint ... The escape hatch is an
explicit insertion-sort `for` loop:
```

Mixed in with the niche items were solid ones (a `Browser closed` fix, `jest.mocked()`
usage), but the grab-bag shape made the body grow in lumps and made the low-value
escapes hard to spot and prune.

**Lesson:** record one concern (or one tightly-related cluster) per change, so each item
is judged on its own merit and a reviewer can see what's actually being added.

## Churn — guidance recorded, then rewritten — story stubs (`22088bd` → `7a25717`)

Story-stub callback guidance was recorded in `22088bd` (a faked-use `return open`
kludge), then **substantially rewritten** a day later in `7a25717` once the actual lint
convention (`_`-prefix `argsIgnorePattern`) was understood. The first recording was
premature — committed as "learning" before it was validated against how the rule really
behaves — so the next agent could have followed a kludge that was about to be replaced.

**Lesson:** confirm the insight before you enshrine it. A gotcha you're still guessing
at isn't compounding knowledge yet — it's a hypothesis. When you *do* correct an earlier
recording, rewrite it in place (as `7a25717` did) rather than annotating it — see
`no-archaeology.md`.
