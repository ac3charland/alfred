# `unicorn/no-useless-undefined` × TS `mockResolvedValue()` — auto-fix breaks typecheck

**Rule(s):** `unicorn/no-useless-undefined` (auto-fix) vs TypeScript `TS2554` (with the jest mock types)
**Package / scope:** frontend — test files mocking a `Promise<void>` function (e.g. `*.test.tsx`)
**Date / branch:** 2026-06-19 · worktree-dry-frontend

## What happened
A test mocks a void-returning async callback (e.g. an `onSave: (next: string) => Promise<void>`):

```ts
const onSave = jest.fn().mockResolvedValue(undefined);
```

`eslint --fix` (the `lint` step of `check:fast`) applies `unicorn/no-useless-undefined`
and strips the argument:

```ts
const onSave = jest.fn().mockResolvedValue(); // ← after --fix
```

…which then fails the **typecheck** step on a subsequent run:

```
error TS2554: Expected 1 arguments, but got 0.
```

This is an order-of-operations trap: `check:fast` runs `typecheck` *before* `lint`, so
the run that introduces the breakage still exits 0 (typecheck saw the good code, then
`--fix` broke it). The **next** gate run (e.g. the pre-commit hook) fails on typecheck.

## Why the rule doesn't fit here
`mockResolvedValue(undefined)` for a `Promise<void>` mock is **not** a useless
`undefined` — the jest types require exactly one argument, and `undefined` is the only
valid resolved value for `void`. `unicorn/no-useless-undefined` doesn't understand the
call signature, so its "fix" produces code TypeScript rejects. The two rules form a
dead end: satisfy one, fail the other.

## Suggested change
Add an `unicorn/no-useless-undefined` option that exempts the jest resolve/reject
mock setters, scoped to test files, e.g.:

```js
{ files: ['**/*.test.{ts,tsx}'],
  rules: { 'unicorn/no-useless-undefined': ['error', {
    checkArguments: false, // or a more targeted allow-list once the rule supports it
  }] } }
```

(`checkArguments: false` stops the rule from stripping `undefined` passed as a call
argument while keeping its other checks.) Alternatively, document the
`jest.fn(() => Promise.resolve())` form below as the house pattern for void mocks.

## Workaround used meanwhile
Rewrote the four void-promise mocks to a form with no `undefined` literal for the rule
to strip, which also typechecks cleanly:

```ts
const onSave = jest.fn(() => Promise.resolve());
```

## Workarounds to rip out if the rule changes
If the rule is adjusted to allow `mockResolvedValue(undefined)`, these can be reverted
to the clearer `jest.fn().mockResolvedValue(undefined)` (optional — the `Promise.resolve`
form is fine to keep):
- [ ] `frontend/lib/hooks/use-inline-edit.test.tsx` (2 mocks)
- [ ] `frontend/components/atoms/editable-text-field.test.tsx` (2 mocks)
