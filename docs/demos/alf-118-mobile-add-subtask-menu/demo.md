---
branch: claude/task-plus-icon-dot-menu-pz6i0k
---

# ALF-118 · Collapse the mobile + into the dot menu

*2026-07-16T21:02:14.553Z*

## What changed

On a phone the task-row action cluster used to show **two** always-visible controls: a `+` (add subtask) and the `⋯` dot menu. ALF-118 collapses the `+` into the dot menu on mobile:

- The inline `+` button is now **desktop-only** (`hidden md:inline-flex`) — unchanged (hover-revealed) at `md`+.
- A leading **"Add subtask"** item (with a `+` glyph) now sits at the **top** of the `⋯` menu on mobile. It's `md:hidden` so desktop — where the visible `+` remains — never doubles up, and it's rendered for **task rows only** (code/unclassified rows nest no subtasks).
- Both affordances open the same inline capture box + expand the subtree.

## Behaviour is pinned by unit tests

The mobile menu affordance and its gating are covered by `task-row.test.tsx`, and the responsive hide by `task-row.styles.test.ts`.

```bash
cd frontend && npm test -- task-row.test task-row.styles.test -t "Add subtask|add subtask|md:hidden|Open details|add-subtask" 2>&1 | grep -E "Tests:|✓|menu|Add subtask" | head -40
```

```output
> jest --passWithNoTests task-row.test task-row.styles.test -t Add subtask|add subtask|md:hidden|Open details|add-subtask
Tests:       191 skipped, 24 passed, 215 total
Ran all test suites matching task-row.test|task-row.styles.test with tests matching "Add subtask|add subtask|md:hidden|Open details|add-subtask".
```

## Visual evidence (mobile Storybook snapshot)

The `Tasks/TaskRow` **MobileCards** baseline moved: with the `+` gone from the head line, the long-title leaf ("Update monthly transfer amounts…") reclaims that width and wraps to fewer lines, so the card frame is shorter (294×503 → 294×452). The 3-panel diff below is **baseline | changed pixels (red) | new render**. The other fixed-height mobile snapshots stay within the 1% tolerance, so only this baseline is re-approved.

![](demo-image-1.png)
