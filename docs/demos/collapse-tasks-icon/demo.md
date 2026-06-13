---
branch: claude/collapse-tasks-icon-jpupby
---

# Collapse all tasks icon

*2026-06-13T18:03:09.899Z*

A `ListCollapse` icon button was added to the top-right header of the inbox list and each folder view. Clicking it fires a subscription-based context event that collapses all expanded task and subtask rows in one shot, resetting both the subtask tree and the "show completed" toggle for every visible row.

```sh
npm run test -w frontend -- --testPathPatterns='task-row.test|folder-view.test|inbox-screen.test' 2>&1 | grep -v "^Time:"
```

```output

> frontend@0.1.0 test
> jest --passWithNoTests --testPathPatterns=task-row.test|folder-view.test|inbox-screen.test


Test Suites: 3 passed, 3 total
Tests:       198 passed, 198 total
Snapshots:   0 total
Ran all test suites matching task-row.test|folder-view.test|inbox-screen.test.
```
