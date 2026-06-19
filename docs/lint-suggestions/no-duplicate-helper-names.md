# `no-duplicate-helper-names` — one home for shared helpers

> **Proposed *new* rule, not a rule-fights-me friction.** Narrow companion to the Phase 3 shared-helper
> consolidation in [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md).

**Rule(s):** core `no-restricted-syntax` (declaration selector) — no new dependency
**Package / scope:** frontend — `frontend/**/*.{ts,tsx}`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
The audit found identical helpers defined in multiple files: `assertNever` in 3 stores, `tempId` in
`code-store` (re-declared instead of importing from `lib/tree`), and `navLinkClass` verbatim in
`folder-nav` and `project-nav`. Phase 3/1 gives each a single canonical home; a re-declaration elsewhere
means a copy was reintroduced.

## Suggested rule
```js
{
  files: ['frontend/**/*.{ts,tsx}'],
  ignores: [
    'frontend/lib/stores/assert-never.ts',
    'frontend/lib/tree.ts',
    'frontend/lib/ui/nav-link-class.ts',
  ],
  rules: {
    'no-restricted-syntax': ['warn',
      { selector: "FunctionDeclaration[id.name='assertNever']", message: 'Import assertNever from lib/stores/assert-never.' },
      { selector: "FunctionDeclaration[id.name='tempId']", message: 'Import tempId from lib/tree.' },
      { selector: "VariableDeclarator[id.name='navLinkClass']", message: 'Import navLinkClass from lib/ui/nav-link-class.' },
    ],
  },
}
```

## Sequencing
Add **with Phase 3** (and the Phase 1 `navLinkClass` extraction), after each helper has its canonical
module and the duplicates are removed.

## Caveats — this is the *narrow* catch
- It only matches helpers **by name**; rename a copy and it slips through. The general solution to
  duplicated *bodies* is the token-level copy-paste detector speced in
  [`docs/specs/frontend-dupe-audit/SPEC.md`](../specs/frontend-dupe-audit/SPEC.md) — this rule is a
  cheap, exact tripwire for the specific known offenders, not a substitute for it.
- **Flat-config caveat:** its `frontend/**` scope overlaps the `components/**` selectors of
  `no-raw-html-button-input` / `no-inline-supabase-from`; the overlapping selectors must be merged into
  one `no-restricted-syntax` entry per file-scope (options replace, not merge).
