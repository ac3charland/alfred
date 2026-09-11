# `unicorn/no-useless-undefined` × `@typescript-eslint/no-empty-function` — no way to write a deliberate no-op `.catch()`

**Rule(s):** `unicorn/no-useless-undefined` (auto-fix) + `@typescript-eslint/no-empty-function`
**Package / scope:** frontend — non-test source (the pair only collides outside `**/*.test.{ts,tsx}`, where `checkArguments: false` already defuses the first rule)
**Date / branch:** 2026-09-09 · oneshot-comms-module

## What happened
An event handler fires an optimistic store action. The action deliberately re-throws after
rolling back and toasting (the house contract in the `data-flow` skill), so the call site has to
account for the rejection or the browser reports an unhandled one — and a component test that
exercises the rollback path fails outright:

```tsx
onClick={() => {
  void setExamplePruned(correction.id, !isPruned).catch(() => undefined);
}}
```

`eslint --fix` applies `unicorn/no-useless-undefined` and rewrites the callback:

```tsx
void setExamplePruned(correction.id, !isPruned).catch(() => {}); // ← after --fix
```

…which the very same run then reports:

```
error  Unexpected empty arrow function  @typescript-eslint/no-empty-function
```

Writing `() => {}` directly fails immediately; writing `() => undefined` is auto-fixed INTO the
failing form. There is no expression-bodied no-op that survives both.

## Why the rule doesn't fit here
A no-op `.catch()` is not a forgotten stub — it is the explicit statement "this failure is
already handled elsewhere", which is exactly true of every optimistic store action in this
codebase: `runOptimisticMutation` rolls back, fires the error toast, and re-throws only so a
caller *may* react. Most callers have nothing to add.

`unicorn/no-useless-undefined` treats the `undefined` as noise because it can't see that the
callback's whole purpose is to have no body, and `no-empty-function` then bans the form the
auto-fix produced. Satisfy one, fail the other.

## Suggested change
Either scope `checkArguments: false` for `unicorn/no-useless-undefined` beyond test files (it is
already set there), or allow empty arrow functions specifically:

```js
{
  files: ['components/**/*.tsx', 'lib/**/*.ts'],
  rules: {
    '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
  },
}
```

The first is narrower and keeps `no-empty-function`'s value for declarations and methods.

## Workaround used meanwhile
Extracted a named helper whose `catch` is a *block* with a comment — `no-empty` ignores commented
blocks, and `no-empty-function` doesn't apply to `catch` clauses:

```ts
export async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Deliberately swallowed — the store's `onError` already surfaced this.
  }
}
```

Call sites read `void settle(action(...))`. The helper is worth having regardless (it names the
intent), but it exists here only because the inline form is unwritable.

## Workarounds to rip out if the rule changes
- [ ] `frontend/components/comms/settle.ts` — the whole module; call sites in
      `person-card.tsx` and `example-card.tsx` can revert to `void action(...).catch(() => undefined)`
      if the pair stops colliding (keeping the helper is also fine — it is more readable).
