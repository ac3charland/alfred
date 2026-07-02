---
branch: claude/mobile-hover-icons-5ahb0f
---

# Always show item/task row actions on mobile (ALF-88)

*2026-07-02T16:29:00.709Z*

The row-actions cluster on every item/task row — **Add subtask** (+) and **More actions** (⋯) — was revealed only on `group-hover`. Touch devices have no hover, so on mobile those controls were unreachable. They're now **always visible below the `md` breakpoint** (the app's mobile boundary — the sidebar is `hidden md:flex`, the mobile header `md:hidden`). On `md`+ pointer devices the hover-reveal is unchanged; the hide is gated on `motion-safe`, so reduced-motion users keep the actions visible at every width.

## Mobile (< md): actions always visible — no hover needed

![A single task row at a 390px-wide mobile viewport: the + (Add subtask) and ⋯ (More actions) icons are visible at the right with no hover](mobile-hover-icons-image-1.png)

## Desktop (md+): unchanged — actions hidden until the row is hovered

![The same task row at a 1280px-wide desktop viewport with no hover: the row-action icons are hidden, exactly as before](mobile-hover-icons-image-2.png)

The visibility rule lives in one place — the extracted `rowActionsClass` — locked by a unit test in `task-row.styles.test.ts`:

```bash
sed -n '/export const rowActionsClass/,/);/p' frontend/components/tasks/task-row.styles.ts
```

```output
export const rowActionsClass = cn(
  'shrink-0 flex items-center gap-1',
  'opacity-100 md:motion-safe:opacity-0 md:motion-safe:group-hover/row:opacity-100',
  'transition-opacity duration-100 motion-reduce:transition-none',
);
```
