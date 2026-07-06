# ALF-31 — Task text overflows and does not wrap, hiding task controls

## Context / problem

A task row (`frontend/components/tasks/task-row.tsx`) lays its contents out as a
single horizontal flex line:

```
[chevron] [checkbox] [title ………………] [type badge] [due chip] [count badges] [hover actions]
```

The title is rendered in a `flex-1 min-w-0` column, and the title text itself
uses the Tailwind `truncate` utility:

- Row container (`task-row.tsx:381`): `flex items-center gap-2 rounded-sm py-2 pr-2`
- Title column (`task-row.tsx:521`): `flex-1 flex flex-col min-w-0 select-none`
- Title span (`task-row.tsx:532`): `text-sm truncate …`

`truncate` forces `white-space: nowrap`, so a long title is pinned to one line.
In practice this lets a long title consume (and visually crowd) the row, and the
text reads as if it overflows toward the controls instead of giving way to them.
The reported symptom is that long task text **does not wrap** and ends up
**hiding / crowding the task controls** (type badge, due-date chip, count badges,
hover actions) on the right of the row.

We want long titles to **wrap onto multiple lines** so the full title is
readable and the row's controls always remain visible and reachable. Confirmed
scope (with the reporter): the fix targets the **main task-row display** (the
rendered title span), and the intended behavior is **wrap to multiple lines**
(not single-line truncation).

## Proposed change

In `frontend/components/tasks/task-row.tsx`, change the main title span so the
title **wraps** instead of being clipped to one line:

1. **Stop truncating the title.** Remove `truncate` from the title span
   (`task-row.tsx:532`) and let the text wrap normally (`whitespace-normal`).
   Keep the existing color / transition classes (`text-sm`,
   `transition-colors duration-300 delay-200 motion-reduce:transition-none`, and
   the completing/completed/active color states) unchanged.

2. **Break long unbroken strings.** Add overflow-wrap handling (Tailwind
   `break-words`) on the title span so a long token with no spaces (e.g. a pasted
   URL) wraps within the column instead of forcing horizontal overflow. The
   `min-w-0` on the title column (`task-row.tsx:521`) stays — it is what lets the
   wrapping column shrink within the flex row rather than push the controls out.

3. **Top-align the row contents.** Switch the main row container
   (`task-row.tsx:381`) from `items-center` to `items-start` so that, when the
   title wraps to multiple lines, the chevron, checkbox, badges, and hover
   actions sit against the **first line** of the title rather than floating to the
   vertical middle of a now-taller row. (For a single-line title the row should
   look effectively unchanged.) If `items-start` visibly misaligns the small
   controls against the text baseline, nudge with existing spacing utilities
   rather than reintroducing center alignment — keep the change minimal.

4. **Leave the secondary context label as-is.** The ancestor/breadcrumb
   `contextLabel` span (`task-row.tsx:544–548`, used in the completed/search
   views) keeps its own `truncate` — it is a secondary, single-line affordance
   and is out of scope for this wrap change.

This is a CSS/layout-class change only; no data, store, or behavioral logic
changes.

## Acceptance criteria

- [ ] A task whose title is longer than the available row width **wraps onto
      multiple lines**; the full title text is visible (no ellipsis clipping on
      the main row title).
- [ ] The task controls — type badge, due-date chip, active/completed count
      badges, and the hover action buttons — **remain visible and clickable** for
      a long-title row; none are pushed off-row or hidden behind the title.
- [ ] A long **unbroken** string (no spaces, e.g. a URL) also wraps within the
      title column and does not cause horizontal overflow of the row.
- [ ] When the title wraps to multiple lines, the chevron/checkbox and the
      right-side controls align to the **first line** of the title (top-aligned
      row), not the vertical center of the taller row.
- [ ] A single-line (short) title row is visually unchanged from today (same
      height and alignment for the common case).
- [ ] Nesting/indentation, completion, inline title editing (double-click),
      due-date editing, and subtask expand/collapse continue to work unchanged.
- [ ] The change is covered by a test that would fail without it. Because the
      overflow behavior is CSS layout (not observable in jsdom), the primary
      evidence is a **Storybook image snapshot**: add a story to
      `task-row.stories.tsx` with a long, wrapping title (and a long unbroken
      string variant) showing the wrapped title with controls still visible, and
      commit the approved baseline PNG. Optionally add a Playwright e2e assertion
      (`frontend/e2e/task-row.spec.ts`) that a control on a long-title row is
      within the viewport / not horizontally clipped.
- [ ] `npm run check` is green. A demo doc capturing the before/after (the
      wrapped-title screenshot, or the Storybook snapshot diff image) is added at
      `docs/demos/ALF-31.md` per the repo workflow.

## Out of scope / open questions

- **Line clamping.** This spec wraps the full title with no maximum line count.
  If very tall rows become a usability problem, a follow-up could clamp to N
  lines (`line-clamp-*`) + ellipsis; not done here.
- **Context/breadcrumb label wrapping.** The secondary `contextLabel` span keeps
  its existing single-line `truncate`; not changed here.
- **Inline title editor & CaptureBox.** The double-click edit `<input>` and the
  capture box are separate input controls (native scroll, not the display span)
  and are not part of this change.
- **Other lists.** Any other place a title is rendered (e.g. folder/search
  surfaces) is out of scope unless it shares this exact span; the fix is scoped
  to the `TaskRow` main title span.
