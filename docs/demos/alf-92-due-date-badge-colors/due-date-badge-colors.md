---
branch: claude/task-badge-colors-91r4qd
---

# Due-date badge urgency colours: overdue red, due today yellow

*2026-07-03T16:58:49.398Z*

ALF-92 splits the task due-date chip into three urgency bands. Previously it had only two — blue for anything today-or-future and amber once overdue. Now overdue is **red**, **due today** gets its own **amber/yellow** treatment, and still-upcoming dates stay **blue** — matching the folder attention badges' red = late / amber = needs-attention convention.

![](due-date-badge-colors-image-1.png)

The `DueDateChip` maps each band to a Badge variant: overdue → the red `overdue` variant, due today → the new amber `dueToday` variant, upcoming → the blue `due` variant. The band boundaries reuse the existing timezone-safe date helpers.
