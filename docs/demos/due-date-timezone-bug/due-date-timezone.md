---
branch: claude/due-date-timezone-bug-4t4s0r
---

# Fix: due date timezone off-by-one

*2026-06-16T20:16:41.641Z*

**Before:** `new Date('YYYY-MM-DD')` parses as UTC midnight. In CDT (UTC−5) that's 7 pm the prior evening — so a task stored as due `2026-06-16` (today) displayed as Jun 15.

![](due-date-timezone-image-1.png)

**After:** `parseDueDate()` in `frontend/lib/date-utils.ts` appends `T00:00:00` (no `Z`) so the engine treats the calendar date as local midnight. The same task now correctly shows Today.

![](due-date-timezone-image-2.png)
