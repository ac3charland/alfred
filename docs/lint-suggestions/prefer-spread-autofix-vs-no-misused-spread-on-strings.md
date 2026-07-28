# `unicorn/prefer-spread` autofix vs `@typescript-eslint/no-misused-spread` — no way to index a string

**Rule(s):** `unicorn/prefer-spread` (autofixes `Array.from(str)` → `[...str]`) +
`@typescript-eslint/no-misused-spread` (forbids spreading a string) + `unicorn/no-for-loop`
**Package / scope:** frontend
**Date / branch:** 2026-07-28 · claude/habit-tracker-tasks-module-5lsw3j

## What happened
Iterating a fixture string one character at a time, needing the index to offset a date:

```ts
for (const [offset, code] of Array.from(codes).entries()) { … }
```

`--fix` rewrote it to `[...codes].entries()`, which then errored:

```
error  Using the spread operator on a string can mishandle special characters, as can
`.split("")` … @typescript-eslint/no-misused-spread
```

Rewriting it as a classic index loop instead:

```ts
for (let offset = 0; offset < codes.length; offset += 1) { … }
```

errors with:

```
error  Use a `for-of` loop instead of this `for` loop  unicorn/no-for-loop
```

So the three rules close every direct route: `Array.from` is autofixed into a banned spread,
the spread is banned, and the index loop is banned.

## Why the rules don't fit here
`no-misused-spread`'s concern is real for user-facing text (emoji and combining marks), but a
`for-of` over the same string decomposes it in exactly the same way — the rule bans one
spelling of an iteration it permits in another. And `prefer-spread`'s autofix is what
*creates* the violation: the code was already written in the form the other rule wants.

## Suggested change
Scope `unicorn/prefer-spread` off where `@typescript-eslint/no-misused-spread` is on (they
disagree by construction), or set `no-misused-spread`'s `allow: ['string']` for test files,
where the strings are ASCII fixtures the author controls.

## Workaround used meanwhile
`for…of` over the string with a hand-maintained `offset` counter, which satisfies all three
rules and is strictly worse to read than either banned form.

## Workarounds to rip out if the rule changes

- [ ] `frontend/lib/habits/streaks.test.ts` — `log()` walks its code string with a manual
      `offset` counter; the clean form is `for (const [offset, code] of Array.from(codes).entries())`.
