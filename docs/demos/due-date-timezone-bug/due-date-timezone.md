---
branch: claude/due-date-timezone-bug-4t4s0r
---

# Fix: due date timezone off-by-one

*2026-06-16T19:52:43.377Z*

JavaScript's `new Date('YYYY-MM-DD')` parses date-only strings as UTC midnight. In CDT (UTC−5), UTC midnight is 7 pm the prior evening — so a task stored as due `2026-06-16` displayed as Jun 15, one day early.

```bash
TZ=America/Chicago node -e "console.log(new Date('2026-06-16').toDateString())"
```

```output
Mon Jun 15 2026
```

`parseDueDate()` in `frontend/lib/date-utils.ts` appends `T00:00:00` (no `Z`) to date-only strings, forcing the engine to parse as local midnight instead of UTC midnight.

```bash
TZ=America/Chicago node -e "console.log(new Date('2026-06-16T00:00:00').toDateString())"
```

```output
Tue Jun 16 2026
```
