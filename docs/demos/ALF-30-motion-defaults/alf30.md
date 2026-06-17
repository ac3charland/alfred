---
branch: claude/hopeful-babbage-aaesaf
---

# ALF-30 — overlay-vs-disclosure motion defaults

*2026-06-17T21:34:04.257Z*

ALF-30 encodes the default mapping from UI element type to motion in the `motion` skill (overlay surfaces fade in/out; in-flow disclosures slide open/closed; inline editing swaps fade) and brings the violating components into line. Part A is the skill text; Part B is the behavioral fix shown below.

### 1. Per-epic board collapse now slides (in-flow disclosure → slide). Previously the expanded epic content was conditionally rendered (`collapsed ? null : …`) and popped in/out with no animation; it now uses the grid-rows height expand/collapse, with aria-hidden + inert on the collapsed region and a motion-reduce guard.

![board epic collapse/expand slide](alf30-video-1.gif)

### 2. Task-row meta panel slides + inline editors fade. The due-date + notes meta panel (`isMetaOpen`) was a conditional render with no animation; it now slides open/closed with the same grid-rows pattern as the sibling subtask list. The due-date and notes display ⇆ editor swaps inside it are inline editing affordances, so they fade in/out (animate-fade-in) rather than slide. The clip shows: chip → panel slides open + date editor fades in → Cancel (date display fades in) → notes editor fades in → Close (panel slides shut).

![task meta panel slide and inline editor fades](alf30-video-2.gif)

### Part A — the `motion` skill now states the default. A new "Default motion by element type" section maps overlay surfaces → fade and in-flow disclosures → slide, with the one-line principle, the inline-editing-swap nuance, and concrete repo examples; the stale `inbox-screen` fade example is corrected to the slide variant, and the description triggers on modal/dropdown/drawer/overlay/"which animation to use".

```bash
grep -A2 '## Default motion by element type' .claude/skills/motion/SKILL.md | head -3
```

```output
## Default motion by element type

Pick motion by **what kind of UI element it is**, so the same category always animates the
```
