---
branch: claude/auto-refresh-loc-graph-b1h73i
---

# LoC graph auto-refreshes once GitHub finishes computing

*2026-09-20T21:16:36.026Z*

ALF-243: the lines-changed card on the Code dashboard used to tell you GitHub was still computing its contributor statistics and to 'Refresh in a minute' — leaving a manual page reload as the only way to see the chart land. The card's data hook (`useLocVelocity` in `frontend/lib/hooks/use-loc-velocity.ts`) now polls the endpoint every 15 seconds (`COMPUTING_POLL_MS`) on its own while the status stays 'computing', and swaps in the real chart the moment GitHub answers — no reload, no click.

Before: the Dashboard hits /code/dashboard while GitHub answers 202 (still computing). The card shows the note and stops there.

![](auto-refresh-loc-graph-image-1.png)

After (same page, no reload, ~15s later): the card's own poll finds the statistics ready and renders the real chart in place of the note.

![](auto-refresh-loc-graph-image-2.png)

Regression coverage: a unit test drives the hook through a fake 15s clock (computing -> ready, and confirms polling stops once it lands and again after unmount), and a Playwright test drives the real running Dashboard through the same journey end to end.

```bash
npm run test -w frontend -- loc-velocity.test.tsx 2>&1 | grep -E 'Tests:|Test Suites:'
```

```output
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

End-to-end: driven through the real running Dashboard (stubbing only the GitHub-backed endpoint, per the repo's e2e convention), with the same 202 -> 200 flip the screenshots above show. The default Playwright assertion timeout is raised for this one wait, since the poll is real wall-clock time (15s), not a mocked clock.

```bash
cd frontend && npx playwright test e2e/code-dashboard.spec.ts --grep 'ALF-243' --reporter=line 2>&1 | sed -E 's/\x1b\[[0-9]*[A-Za-z]//g' | grep -E 'passed|failed|›' | sed -E 's/\([0-9.]+m?s\)//'
```

```output
[1/2] [setup] › e2e/auth.setup.ts:14:6 › authenticate
[2/2] [chromium] › e2e/code-dashboard.spec.ts:209:5 › swaps the chart in on its own, with no reload, once GitHub finishes computing (ALF-243)
  2 passed 
```
