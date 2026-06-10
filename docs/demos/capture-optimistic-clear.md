# Capture box: optimistic clear & saving spinner

*2026-06-10T21:06:27.354Z*

Hitting Enter in the capture box now clears and re-enables the input immediately (optimistically), instead of leaving it disabled showing the just-submitted text while the POST is in flight. The new item still appears in the inbox optimistically via the tasks store. If the user captures another item before the previous one finishes saving, a loading spinner (role `status`, label "Saving") appears in the `Capture` button and stays until every in-flight save drains. On failure the optimistic row rolls back and the failed text is restored to the box so the capture is never lost.

The behavior is locked in by four new tests in `capture-box.test.tsx`: "optimistically clears and keeps the textarea enabled before the save resolves", "does not show a saving spinner for a single in-flight capture", "shows a saving spinner when a new item is captured before the previous one saves", and "shows an error message and restores the text when createItem fails". Running just the capture-box suite:

```bash
npm run test -w frontend -- capture-box 2>&1 | grep -E 'Tests:|Test Suites:'
```

```output
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

And the full frontend unit suite stays green — nothing regressed:

```bash
npm run test -w frontend 2>&1 | grep -E 'Tests:|Test Suites:'
```

```output
Test Suites: 20 passed, 20 total
Tests:       182 passed, 182 total
```
