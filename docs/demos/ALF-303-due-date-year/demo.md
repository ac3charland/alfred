---
branch: claude/stoic-dirac-4lecj0
---

# ALF-303: the due date badge shows the year when it isn't this year

*2026-11-20T02:59:34.832Z*

Before this change every badge read a bare `Mon D`, so a task due Mar 4 next year looked the same as one due Mar 4 this year. Now a due date outside the current year gets its year: `Mar 4, 2027`. A date inside the current year still reads `Jan 15`. Today / Tomorrow / Yesterday stay relative, including across New Year (Dec 31 → `Tomorrow` for Jan 1).

The `Tasks/DueDateChip › AcrossYears` story, captured on 2026-11-20. Top row: last year (red, overdue), this year (no year), next year (blue). Bottom row: a timed next-year chip (`Mar 4, 2027 3 PM`) and the detail panel's larger chip, which uses the same label.

![](demo-image-1.png)

Two committed Storybook baselines moved, both because their fixtures sit in 2099. Each diff below is baseline | changed pixels | new. First, the detail panel: the chip now reads `Aug 7, 2099`.

![](demo-image-2.png)

Second, the mobile task cards: `Jul 9, 2099` and `Jul 12, 2099`. On a narrow card the longer badge pushes the `0/1` subtask counter onto its own line. That only happens for other-year dates, and it is the cost of showing the year.

![](demo-image-3.png)
