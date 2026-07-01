# `unicorn/no-array-sort` vs tsconfig `lib` (no `toSorted`) — a dead end for `Array#sort()`

**Rule(s):** `unicorn/no-array-sort` (autofixes to `Array#toSorted()`) + tsconfig
`compilerOptions.lib` not including `es2023`
**Package / scope:** frontend
**Date / branch:** 2026-07-01 · claude/refetch-ticket-statuses-31flil

## What happened
Sorting the keys of an object in a unit test:

```ts
expect(Object.keys(patch).sort()).toEqual(['blocked_reason', 'factory_state', 'lane']);
```

ESLint errored:

```
error  Use `Array#toSorted()` instead of `Array#sort()`  unicorn/no-array-sort
```

Applying the fix (`.toSorted()`) then fails the typecheck, because the project's
`lib` predates `Array.prototype.toSorted`:

```
error TS2550: Property 'toSorted' does not exist on type 'string[]'. Do you need to
change your target library? Try changing the 'lib' compiler option to 'es2023' or later.
```

So the lint rule pushes toward an API the type-check forbids — the two gates
disagree with no in-code resolution that satisfies both.

## Why the rule doesn't fit here
`no-array-sort` exists to steer away from the *in-place* mutation of `sort()`, but its
only autofix target (`toSorted`, ES2023) isn't in the compiled `lib`, so it's
unreachable. Any code that legitimately wants a sorted copy hits this dead end and has
to restructure to avoid sorting at all.

## Suggested change
Either raise the frontend tsconfig `lib` to include `es2023` (so `toSorted` /
`toReversed` / `with` type-check and the rule's autofix is usable), or disable
`unicorn/no-array-sort` until the `lib` is bumped. Bumping `lib` is the better fix —
it unblocks the whole ES2023 array-copy family the rule wants.

## Workaround used meanwhile
Restructured the assertion to not sort at all — asserting exact object equality
(`expect(patch).toEqual({...})`), which inherently proves the key set with no ordering
step.

## Workarounds to rip out if the rule changes

- [ ] `frontend/lib/code/status.test.ts` — the "omits non-status fields" test asserts
      whole-object equality to sidestep sorting the key list; once `toSorted` type-checks,
      a `Object.keys(patch).toSorted()` assertion is the more direct expression if preferred.
