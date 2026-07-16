---
branch: claude/mobile-textbox-zoom-b3q120
---

# Fix mobile focus-zoom on text fields (ALF-115)

*2026-07-16T20:56:21.927Z*

**Bug (ALF-115):** on a phone, focusing a text field — the item Notes editor, a subtask-creation field, really any input under 16px — made mobile Safari zoom in and strand the viewport zoomed, forcing a manual pinch-out. The Inbox capture box (rendered at `text-base` = 16px) was unaffected, which is exactly the tell.

**Root cause:** iOS Safari auto-zooms into any focused form control whose font-size is below 16px. Our dense UI renders most fields at `text-sm` (14px), and the Notes editor at an arbitrary `text-[13.5px]` — both under the threshold.

**Fix:** one global, coarse-pointer-only rule in `globals.css` lifts every `input`/`textarea`/`select` to a 16px minimum on touch devices. It's left UNLAYERED so it wins over Tailwind's layered utilities (`text-sm`, `text-[13.5px]`) regardless of specificity — catching *any* text field without hunting each className. Desktop keeps its dense sizing (the rule never matches a fine pointer).

### The shipped rule

```text
grep -A6 'pointer: coarse' frontend/app/globals.css
```

```output
@media (pointer: coarse) {
  input,
  textarea,
  select {
    font-size: 16px;
  }
}
```

### The regression guard — a touch-viewport E2E asserting each flagged field renders at ≥16px

```text
grep -nE "test.use|toBeGreaterThanOrEqual|getByRole..textbox|getByPlaceholder" frontend/e2e/mobile-input-zoom.spec.ts
```

```output
16:test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
42:  const notes = page.getByRole('textbox', { name: 'Notes' });
44:  expect(await fontSizePx(notes)).toBeGreaterThanOrEqual(16);
56:  const subtaskBox = page.getByPlaceholder('Add subtask…');
58:  expect(await fontSizePx(subtaskBox)).toBeGreaterThanOrEqual(16);
```

Both cases pass under `npm run test:e2e` (part of `check:slow`): with `hasTouch: true` the coarse-pointer rule engages and the Notes editor (was 13.5px) and subtask field (was 14px) both resolve to 16px, so Safari no longer zooms on focus. On a desktop (fine pointer) the rule never matches, so the dense sizing is untouched.
