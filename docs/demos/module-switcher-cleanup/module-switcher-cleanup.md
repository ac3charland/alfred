---
branch: claude/laughing-ritchie-c7w8wk
---

# Module switcher: fits the sidebar, and Tasks gets its own hue

*2026-09-12T13:10:31.784Z*

ALF-219 had two halves. The desktop switcher **overflowed its sidebar**: the control hugged its labels (`w-fit`, from ALF-93, when there were only two segments) and a third segment pushed it past the 224px sidebar's border, leaving "Comms" floating over the main pane. And **Tasks and Code both wore the app's teal**, so a highlighted segment told you a module was active but not which one.

## Before: the switcher crosses the sidebar border

The live app on `/priority`. The sidebar's right border sits at x=223; the switcher's box runs to ~237, and "Comms" is drawn on the wrong side of it.

![](module-switcher-cleanup-image-1.png)

## After: it fits, and each module owns a hue

Tasks active — the control ends inside the sidebar, all three labels shown in full, and the highlight is amber:

![](module-switcher-cleanup-image-2.png)

Code active — same control, and the teal is now Code's alone:

![](module-switcher-cleanup-image-3.png)

## How it fits: sized from the container, not from the labels

The control is `w-full` now, and each segment is `flex-auto` — basis *content*, so a segment starts at its own label's width and only the leftover space is shared out. `flex-1` (basis 0) would hand all three equal thirds, which is what the narrowest label needs, and clip "Comms". `min-w-0 truncate` is the floor under that: a fourth module would truncate *inside* the control rather than burst the sidebar again.

```bash
sed -n '/^const segmentClass/,/^  );/p' frontend/components/shell/view-switcher.tsx | grep -E "flex-auto|px-1.5"
```

```output
    // `flex-auto` (basis: content), not `flex-1` (basis: 0): each segment starts at its own
    'flex-auto min-w-0 truncate rounded-md px-1.5 py-1 text-center text-sm font-medium',
```

The width budget the measurements landed on: 181px of inner space (223px sidebar − 32px of `px-4` − 2px group border − 8px of `p-1`), 131px of label text, 2px of `gap-0.5`, leaving ~14px of padding per segment. `px-2` (16px) was 6px over and clipped "Comms"; `px-1.5` (12px) fits with ~12px to spare.

## One hue per module

The colour lives in one table, so the switcher, the sidebar and every view heading move together:

```bash
grep -E "^  (tasks|code|comms):|^    text:" frontend/lib/modules.ts
```

```output
  tasks: {
    text: 'text-accent-amber',
  code: {
    text: 'text-accent-teal',
  comms: {
    text: 'text-accent-blue',
```

## The moved visual baselines

The committed Storybook snapshots moved, and the snapshot gate's own 3-panel diff is the evidence — **left** the old baseline, **middle** the changed pixels, **right** the new render. The stories are now framed in the sidebar's real geometry (`w-56` + `px-4`), because a control that sizes itself from its container tells you nothing when captured loose on the canvas — it would just stretch to the canvas width.

![](module-switcher-cleanup-image-4.png)

![](module-switcher-cleanup-image-5.png)

![](module-switcher-cleanup-image-6.png)

## The coupling the recolour exposed

`ViewHeading` defaults its `accent` to Tasks, and the Code module's three headings — Backlog, Needs human action, The Software Factory — had never declared their own: while Tasks and Code shared one teal, riding the default was invisibly correct. Recolouring Tasks would have turned those Code headings amber, so they now name their module:

```bash
grep -rn -B1 'accent="code"' frontend/components/code/*.tsx
```

```output
frontend/components/code/backlog.tsx-66-          description="Every story across your projects, ranked by priority."
frontend/components/code/backlog.tsx:67:          accent="code"
--
frontend/components/code/dashboard.tsx-52-        description="Your code module at a glance — what you're shipping, and what's waiting on you."
frontend/components/code/dashboard.tsx:53:        accent="code"
--
frontend/components/code/needs-human-action.tsx-35-        description="Stories waiting on your review — a spec to approve or a gate to clear."
frontend/components/code/needs-human-action.tsx:36:        accent="code"
```
