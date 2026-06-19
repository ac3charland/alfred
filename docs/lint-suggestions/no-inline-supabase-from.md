# `no-inline-supabase-from` — keep Supabase queries in the data layer

> **Proposed *new* rule, not a rule-fights-me friction.** Mechanizes an existing `data-flow`
> convention; reinforced by Phase 3/4 of
> [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md).

**Rule(s):** core `no-restricted-syntax` (member-call selector) — no new dependency
**Package / scope:** frontend — `frontend/components/**`, `frontend/lib/stores/**`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
The `data-flow` skill already states it as a convention — "never inline `supabase.from('…')` in a
Server Component; add/clarify a `lib/data/*` reader" and "never create a supabase client in a
component" — but nothing enforces it. The audit (D5) found GET route handlers building queries inline
too. Reads belong in `lib/data/*`; writes go through route handlers + `lib/api-client`.

## Suggested rule
```js
{
  files: ['frontend/components/**/*.{ts,tsx}', 'frontend/lib/stores/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': ['warn', {
      selector: "CallExpression[callee.property.name='from'][callee.object.name='supabase']",
      message: 'Do not query Supabase here. Reads → a lib/data/* reader; writes → a store action → route handler.',
    }],
  },
}
```

## Sequencing
Can land any time (the convention already exists), but pairs naturally with **Phase 3** (stores) /
**Phase 4** (moving GET queries into `lib/data/*`).

## False-positive scope / exemptions
- **Exempt the one sanctioned client-side user:** `components/auth/login-form.tsx` (the documented
  browser-client exception).
- The `[callee.object.name='supabase']` guard avoids matching unrelated `.from()` calls
  (`Array.from`, etc.); if a file names the client something other than `supabase`, the rule won't
  catch it — accept that narrowness rather than broadening to every `.from(` and creating noise. The
  generic catch-all is the copy-paste detector, not this rule.
- **Flat-config caveat:** combine this selector with the other `components/**`-scoped
  `no-restricted-syntax` proposals into one entry per file-scope (options replace, not merge).
