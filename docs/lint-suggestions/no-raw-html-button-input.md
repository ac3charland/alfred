# `no-raw-html-button-input` — steer feature components to the shared primitives

> **Proposed *new* rule, not a rule-fights-me friction.** This inverts the usual inbox direction:
> it asks to *add* back-pressure that locks in the Phase 1 primitives from
> [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md). Filed here
> because the inbox is the repo's channel for routing lint-rule decisions to a human reviewer.

**Rule(s):** core `no-restricted-syntax` (JSX selectors) — no new dependency
**Package / scope:** frontend — `frontend/components/{tasks,code,shell,auth}/**/*.tsx`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
The DRY audit found feature components hand-rolling raw `<button>` / `<input>` / `<textarea>` with
duplicated Tailwind class clusters (focus rings, accent-teal buttons, dense inline inputs) instead of
the shared primitives — `Button` (`components/ui/button`), `IconButton` / `TextField`
(`components/atoms`), and the Phase-1 `TextareaField`. Each copy drifts and re-states styling the
primitive already owns.

## Suggested rule
Add a feature-scoped config block (severity **warn** first, promote to **error** once call sites are
clean):

```js
{
  files: ['frontend/components/{tasks,code,shell,auth}/**/*.tsx'],
  rules: {
    'no-restricted-syntax': ['warn',
      { selector: "JSXOpeningElement[name.name='button']",
        message: 'Use <Button> (components/ui/button) or <IconButton> (components/atoms) — not a raw <button>.' },
      { selector: "JSXOpeningElement[name.name='input']",
        message: 'Use <TextField> (components/atoms) or <Input> (components/ui) — not a raw <input>.' },
      { selector: "JSXOpeningElement[name.name='textarea']",
        message: 'Use <TextareaField> (Phase 1) — not a raw <textarea>.' },
    ],
  },
}
```

## Sequencing
Add **with Phase 1**, once `Button`/`TextField`/`TextareaField` cover the cases — not before, or it
forbids something with no replacement.

## False-positive scope / exemptions
- **Exempt the primitives themselves:** `components/ui/**` and `components/atoms/**` legitimately render
  the raw elements — don't apply the block there.
- Exempt tests and stories (`*.test.tsx`, `*.stories.tsx`, `e2e/**`).
- **Flat-config caveat:** `no-restricted-syntax` options *replace* (don't merge) across overlapping
  globs. Combine these selectors with the other `components/**`-scoped proposals
  (`no-inline-supabase-from`, `no-duplicate-helper-names`) into **one** entry per file-scope, or the
  later config block silently drops the earlier selectors.
