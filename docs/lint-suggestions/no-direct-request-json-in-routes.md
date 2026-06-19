# `no-direct-request-json-in-routes` — parse + validate through the shared helper

> **Proposed *new* rule, not a rule-fights-me friction.** Locks in the Phase 4 API plumbing from
> [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md).

**Rule(s):** core `no-restricted-syntax` (call selector) — no new dependency
**Package / scope:** frontend — `frontend/app/api/**/route.ts`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
The audit (D1) found the same `try { body = await request.json() } catch { jsonError(400, …) }`
followed by `schema.safeParse(...)` copy-pasted across **9** POST/PATCH handlers. Phase 4 introduces
`parseRequestBody(request, schema)` (`lib/api/parsing`) so the parse-and-validate step is written once.
A bare `request.json()` in a route handler after that means someone re-inlined the boilerplate.

## Suggested rule
```js
{
  files: ['frontend/app/api/**/route.ts'],
  rules: {
    'no-restricted-syntax': ['warn', {
      selector: "CallExpression[callee.property.name='json'][callee.object.name='request']",
      message: 'Parse + validate via parseRequestBody(request, schema) (lib/api/parsing) instead of request.json() directly.',
    }],
  },
}
```

## Sequencing
Add **with Phase 4**, strictly *after* `parseRequestBody` exists — before that, every handler legitimately
calls `request.json()` and the rule would be pure noise. Start **warn**, promote to **error** once all
nine handlers are migrated.

## False-positive scope / exemptions
- Scope is `app/api/**/route.ts` only, so it doesn't collide with the `components/**`-scoped
  `no-restricted-syntax` proposals — this can be its own config block.
- If a handler ever needs the raw body (e.g. a webhook verifying a signature over the exact bytes), that
  reads `request.text()` / `request.arrayBuffer()`, not `request.json()`, so it isn't caught — good.
