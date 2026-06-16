---
branch: claude/due-date-timezone-bug-4t4s0r
---

# Fix: due date timezone off-by-one

*2026-06-16*

`new Date('YYYY-MM-DD')` parses as UTC midnight. In negative-UTC timezones like CDT (UTC-5), UTC midnight is the previous local evening — so a task saved as due `2026-06-16` (today) displayed as "Jun 15", and one saved as `2026-06-17` (tomorrow) showed as "Today".

The fix adds a `parseDueDate()` helper in `frontend/lib/date-utils.ts` that appends `T00:00:00` (no Z) to date-only strings, making the engine treat them as local midnight. Tests were updated to use plain `YYYY-MM-DD` strings directly (removing the old UTC-offset compensation workaround from `localDueDate`), and two new regression tests confirm the correct behavior.

```sh
npm run test -w frontend -- --testPathPatterns=date-utils 2>&1 | grep -v "^Time:"
```

```output

> frontend@0.1.0 test
> jest --passWithNoTests --testPathPatterns=date-utils

Test Suites: 1 passed, 1 total
Tests:       37 passed, 37 total
Snapshots:   0 total
Ran all test suites matching date-utils.
```
