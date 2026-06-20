---
branch: worktree-dry-frontend
---

# Phase 3 — Store / data-flow factories

*2026-06-19T21:00:04.943Z*

Phase 3 extracts the repeated optimistic-mutation dance (~20 copies across the stores) and the React context-provider scaffold into shared factories under `lib/stores/`:

- `optimistic-mutation.ts` — the reusable optimistic apply → call API → reconcile-on-success / rollback-on-throw helper that every store's mutating action now routes through.

- `create-context-pair.ts` — the `createContext` + typed `useContext` provider/hook pair factory, replacing the hand-rolled provider boilerplate in each store.

- `reducer-actions.ts` + `assert-never.ts` — typed reducer-action plumbing with exhaustiveness checking.

The tasks / folders / code / active-editor / expansion / toast stores all adopt these factories, and `lib/tree.ts` (the subtask-tree builder) is unchanged in behavior. This is internal plumbing with NO UI delta, so the proof is that every store + tree test stays green with no assertion changes:

```bash
npm run --silent test -w frontend -- --silent --json lib/stores lib/tree 2>/dev/null \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(`suites: ${d.numPassedTestSuites}/${d.numTotalTestSuites} | tests: ${d.numPassedTests}/${d.numTotalTests} | failures: ${d.numFailedTests}`)'
```

```output
suites: 10/10 | tests: 214/214 | failures: 0
```

The new factory modules also carry their own unit tests (per the TDD rule for new shared code). Confirm they exist:

```bash
cd frontend
ls lib/stores/optimistic-mutation.test.ts lib/stores/create-context-pair.test.tsx lib/stores/reducer-actions.test.ts lib/stores/assert-never.test.ts
```

```output
lib/stores/assert-never.test.ts
lib/stores/create-context-pair.test.tsx
lib/stores/optimistic-mutation.test.ts
lib/stores/reducer-actions.test.ts
```
