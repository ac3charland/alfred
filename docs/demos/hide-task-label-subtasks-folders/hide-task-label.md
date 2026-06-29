---
branch: claude/relaxed-cray-61uir0
---

# Hide the "Task" label for subtasks and tasks in folders (ALF-65)

*2026-06-29T16:33:09.765Z*

The type badge tells inbox triage apart, but the "Task" label is redundant wherever the type is already implied: a subtask sits under a task, and every item filed in a folder is a task. ALF-65 suppresses the "Task" badge in those two contexts. The "Code" badge stays everywhere (the rare, meaningful distinction), and an unclassified row still shows nothing.

## Baseline: a root Inbox task still shows the "Task" badge

![](hide-task-label-image-1.png)

## A subtask shows no "Task" badge

![](hide-task-label-image-2.png)

## A task filed in a folder shows no "Task" badge

![](hide-task-label-image-3.png)

## "Code" is unaffected — it still shows everywhere

![](hide-task-label-image-4.png)
