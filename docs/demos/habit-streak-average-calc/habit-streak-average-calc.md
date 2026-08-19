---
branch: claude/habit-streak-average-calc-wn3amz
---

# Average streak includes the current streak

*2026-08-19T21:10:51.925Z*

`averageStreak` (frontend/lib/habits/streaks.ts) used to average only the habit's ENDED runs, explicitly excluding whatever streak is still in progress. That meant a habit with a single long-running streak and no completed run yet reported `averageStreak: null` even though it clearly has an average streak length — itself. It also meant the number silently dropped the most recent, most relevant data point.

The fix: the current run now counts in the average too, at whatever length it has reached so far — the same way `longestStreak` already always included it. A run of nothing but forgiven days (met-day count of 0) still contributes nothing, same as before.

```bash
npm run test -w frontend -- streaks.test.ts -t 'average' 2>&1 | grep -v '^Time:'
```

```output

> frontend@0.1.0 test
> jest --passWithNoTests streaks.test.ts -t average

Test Suites: 1 passed, 1 total
Tests:       44 skipped, 3 passed, 47 total
Snapshots:   0 total
Ran all test suites matching streaks.test.ts with tests matching "average".
```

The three passing tests above (`frontend/lib/habits/streaks.test.ts`) walk it end to end:

- A single still-growing 3-day run → `averageStreak` is now `3`, not `null`.
- No run has ever formed at all (nothing logged, allowance 0) → `averageStreak` stays `null` — that's the genuine null case now.
- A 4-day run that ended, followed by a fresh 1-day run still going → `averageStreak` is `(4 + 1) / 2 = 2.5`, where it used to report just `4`.

`app/api/habits/route.test.ts` (the API payload, driven through the same engine) moves the same way: a habit with one 7-day run still in progress now reports `average_streak: 7` instead of `null`.

```bash
npm run test -w frontend -- app/api/habits/route.test.ts -t 'derived numbers' 2>&1 | grep -v '^Time:'
```

```output

> frontend@0.1.0 test
> jest --passWithNoTests app/api/habits/route.test.ts -t derived numbers

Test Suites: 1 passed, 1 total
Tests:       38 skipped, 1 passed, 39 total
Snapshots:   0 total
Ran all test suites matching app/api/habits/route.test.ts with tests matching "derived numbers".
```
