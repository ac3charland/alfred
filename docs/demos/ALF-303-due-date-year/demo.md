---
branch: claude/stoic-dirac-4lecj0
---

# ALF-303: the due date badge shows the year when it isn't this year

*2026-11-20T02:59:34.832Z*

Before this change every badge read a bare `Mon D`, so a task due Mar 4 next year looked the same as one due Mar 4 this year. Now a due date outside the current year gets its year: `Mar 4, 2027`. A date inside the current year still reads `Jan 15`. Today / Tomorrow / Yesterday stay relative, including across New Year (Dec 31 → `Tomorrow` for Jan 1).

The `Tasks/DueDateChip › AcrossYears` story, captured on 2026-11-20. Top row: last year (red, overdue), this year (no year), next year (blue). Bottom row: a timed next-year chip (`Mar 4, 2027 3 PM`) and the detail panel's larger chip, which uses the same label.

![](demo-image-1.png)
