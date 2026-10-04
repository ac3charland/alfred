# `unicorn/prefer-dom-node-dataset` vs tsconfig `noPropertyAccessFromIndexSignature` — the autofix doesn't type-check

**Rule(s):** `unicorn/prefer-dom-node-dataset` (autofix) + tsconfig
`compilerOptions.noPropertyAccessFromIndexSignature`
**Package / scope:** frontend (seen in `components/**/*.test.tsx`)
**Date / branch:** 2026-10-04 · alf-334/replay-307-high-r1

## What happened
A test reading a data attribute off an element:

```ts
element.parentElement?.getAttribute('data-testid') === 'comms-conversation'
```

`npm run lint` (`eslint --fix`) rewrote it to `element.parentElement?.dataset.testid`, and the
typecheck then failed:

```
error TS4111: Property 'testid' comes from an index signature, so it must be accessed with ['testid'].
```

## Why the rule doesn't fit here
`DOMStringMap` is an index-signature type, so with `noPropertyAccessFromIndexSignature` on, the
rule's only autofix target (`dataset.x`) never type-checks. The rule pushes every
`getAttribute('data-*')` toward code tsc forbids; `dataset['testid']` would satisfy both, but the
autofix doesn't emit it.

## Suggested change
Turn `unicorn/prefer-dom-node-dataset` off in `frontend/eslint.config.*` (it adds nothing a
reviewer needs, and its fix is wrong under this tsconfig), or keep it and accept
`dataset['x']` as the house spelling.

## Workaround used meanwhile
`element.parentElement?.matches('[data-testid="comms-conversation"]')` — a selector, which
neither rule looks at.

## Workarounds to rip out if the rule changes
- [ ] `frontend/components/comms/comms-queue-view.test.tsx` — the `header()` helper's `.matches(...)`
