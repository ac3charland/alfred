# ALF-30 — Add animation guidance (default to fade in/out, slide open/close) and bring components into line

## Context / problem

alfred's motion is deliberately restrained (SPEC §5.4) and the `motion` skill
(`.claude/skills/motion/SKILL.md`) already documents the *mechanics* of the
project's reusable motion: the `--animate-*` tokens, the fade reveal/collapse
pattern, the grid-rows height expand/collapse, reduced-motion handling, and the
testing gotchas.

What it does **not** yet give is an up-front **default mapping** from a *kind of
UI element* to the *kind of motion it should use*. Today an agent reaching for
the skill learns "here's how to fade" and "here's how to slide a height open,"
but has to infer **which one to pick** for, say, a dropdown menu vs. an inline
subtask expansion. The skill even hints at the ambiguity: one Plain-English row
("Fade + slide a panel in") suggests overlays can fade *and* slide with no stated
default. The result is the risk of inconsistent choices across components —
exactly the "feels AI-generated" inconsistency restraint is meant to avoid.

This ticket does **two** things:

1. **Encode the default** in the `motion` skill so every future session animates
   the same category of thing the same way — **modals / floating menus fade in/out;
   expansions / drawers slide open/closed.**
2. **Audit the existing components and fix any that violate the new default**, so
   the codebase actually matches the guidance we're writing down (and the skill's
   own examples stay accurate).

The ticket left terminology to refinement ("settle on terminology in
refinement"); this spec settles it (see *Terminology*).

## Terminology (settled)

Two categories, named so the mapping is unambiguous:

- **Overlay surface** — content rendered *above* the page (typically in a
  portal), transient and dismissible, **not** part of normal document flow, and
  it does **not** reflow surrounding content when it appears. Examples in this
  repo: dialogs/modals (`cascade-modal.tsx`, `story-detail-modal.tsx`, the
  `code/*-dialog.tsx` set), dropdown / context menus (`ui/dropdown-menu.tsx` and
  its users), popovers, tooltips, command palettes, **and toasts**. The ticket's
  "modals / floating menus."
- **In-flow disclosure** — content that expands/collapses *within* the document
  flow, taking up space and pushing sibling content as it opens/closes. Examples:
  the inline subtask list (`task-row.tsx`), the landing ⇆ inbox reveal
  (`inbox-screen.tsx`), the per-epic board collapse (`code/board.tsx`),
  accordions, collapsible panels, and edge drawers / sheets. The ticket's
  "expansions / drawers."

## The default (settled)

- **Overlay surface → fade in / fade out** (opacity is the through-line).
- **In-flow disclosure → slide open / slide closed** (animate size/position, not
  just opacity — e.g. the grid-rows height expand/collapse).
- **One-line principle:** *an overlay that floats over the page fades; content
  that opens within the page slides.*
- **Allowed accents (pragmatic, not strict):** a fade is *required* on every
  overlay, but a documented compound flourish on top of it is fine — e.g. the
  Radix `zoom-in-95` / per-side `slide-in-from-*` accents on a menu or modal stay.
  What's wrong is a **pure slide with no fade on an overlay**, or a **pure fade
  with no size/position change on an in-flow disclosure** (a drawer that only
  fades reads as a popup, not a drawer), or **no animation at all** on an in-flow
  disclosure. Every default still pairs with its `motion-reduce:` guard.

## Audit findings (current state)

Surveyed all overlay and in-flow components. Disposition under the pragmatic rule
("require fade on overlays / slide on in-flow disclosures; keep existing flourishes;
fix only true violations"):

| Component | Category | Current motion | Verdict |
|---|---|---|---|
| `tasks/cascade-modal.tsx` | overlay (modal) | fade + `zoom-95` | ✅ conforms (fade present; zoom is an allowed accent) |
| `code/story-detail-modal.tsx` | overlay (modal) | fade | ✅ conforms |
| `code/gate-dialog.tsx` | overlay (modal) | fade | ✅ conforms |
| `code/new-epic-dialog.tsx` | overlay (modal) | fade | ✅ conforms |
| `code/new-project-dialog.tsx` | overlay (modal) | fade | ✅ conforms |
| `ui/dropdown-menu.tsx` (+ `folder-nav.tsx` etc.) | overlay (menu) | fade + `zoom-95` + per-side `slide-in-from-*` | ✅ conforms (fade present; zoom/slide are allowed accents) |
| `shell/toast-viewport.tsx` | overlay (toast) | `animate-fade-in` | ✅ conforms (toast treated as an overlay → fade; decided in refinement) |
| `tasks/task-row.tsx` (subtask list) | in-flow disclosure | grid-rows slide | ✅ conforms |
| `tasks/inbox-screen.tsx` (landing ⇆ inbox) | in-flow disclosure | `animate-expand-y` / `animate-collapse-y` (slide) | ✅ conforms — **but the motion skill text still describes this as the *fade* reveal pattern; that example is stale and must be corrected** |
| `code/board.tsx` (per-epic collapse) | in-flow disclosure | **conditional render (`collapsed ? null : …`), no animation** | ❌ **violation — collapse/expand has no slide; this is the headline fix** |

**Net:** the overlays already fade and the other expansions already slide; the
one true behavioral violation is `code/board.tsx`, whose per-epic
collapse/expand mounts/unmounts with no animation. Plus one **documentation**
correction (the stale `inbox-screen` example in the skill).

## Proposed change

### Part A — Skill guidance (`.claude/skills/motion/SKILL.md`)

1. **Add a "Default motion by element type" section** (rule + table) right after
   the existing "Decision Tree", before the "Plain-English → Pattern Table",
   capturing the mapping and the one-line principle above, naming concrete repo
   examples per category, and pointing at the already-written patterns (fade
   reveal/collapse, grid-rows expand/collapse, animate-then-commit) rather than
   re-explaining them.
2. **Reconcile the existing "Fade + slide a panel in" row** with the new default:
   fade is the default for overlays, the compound slide/zoom is an *allowed
   accent*, and pure-slide-overlay / pure-fade-drawer / no-animation-disclosure
   are the wrong choices.
3. **Correct the stale `inbox-screen` example.** The skill currently cites
   `inbox-screen.tsx` as a user of the *fade* reveal/collapse pattern; the code
   now uses `animate-expand-y` / `animate-collapse-y` (a slide). Update the
   reference so the skill's example matches reality (and matches the new default —
   the landing ⇆ inbox swap is an in-flow disclosure, so a slide is correct).
4. **Reduced motion stays mandatory** — restate that each default still pairs with
   its `motion-reduce:` guard.
5. **Authoring constraints:** read the `compounding-learning` skill first
   (house style); extend the `description` frontmatter with the new trigger
   vocabulary (modal, dropdown, floating menu, drawer, overlay, "which animation
   to use") without exceeding `skill-lint`'s limits; the edited `SKILL.md` must
   pass `skill-lint` (`npm run lint:skills -w tools/skill-lint`).

### Part B — Bring components into line (the fix)

1. **`code/board.tsx` — give the per-epic collapse a slide.** Replace the
   no-animation conditional render of the expanded epic content (header actions +
   swimlane row) with the project's in-flow disclosure pattern: the grid-rows
   `0fr ⇆ 1fr` expand/collapse (the same `transition-[grid-template-rows]
   ease-out` + `overflow-hidden` inner div used by `task-row.tsx`, or the
   `animate-expand-y` / `animate-collapse-y` tokens), with `aria-hidden` + `inert`
   on the collapsed region and a `motion-reduce:` guard. Use the existing tokens/
   patterns — **no new motion token.** Keep the board-local collapsed-set state
   and the collapse-all behavior unchanged; this is a presentation change to *how*
   the content appears/disappears, not *whether* it does.
2. **Re-run the audit method while implementing.** The table above is the known
   set; before finishing, sweep for any other in-flow disclosure that renders
   conditionally with no slide (the `x ? null : <…/>` / `{open && <…/>}` shape on
   content that reflows the page) and fix it the same way, or note in the PR that
   none were found.
3. **No change to the conforming components.** Per the pragmatic decision, the
   fading overlays and their zoom/slide accents are left as-is; toasts stay a fade.

## Acceptance criteria

**Skill guidance**

- [ ] `.claude/skills/motion/SKILL.md` has a clearly-titled default-motion section
      mapping **overlay surfaces → fade in/out** and **in-flow disclosures → slide
      open/closed**, with the one-line principle and concrete repo examples.
- [ ] The existing "Fade + slide a panel in" guidance is reconciled: fade is the
      overlay default; zoom/slide are allowed accents; pure-slide-overlay,
      pure-fade-drawer, and no-animation-disclosure are called out as wrong.
- [ ] The stale `inbox-screen` skill example is corrected to reflect that it uses
      `animate-expand-y` / `animate-collapse-y` (a slide), not a fade reveal.
- [ ] The new guidance restates the mandatory `motion-reduce:` pairing and points
      to the existing patterns instead of duplicating them.
- [ ] The skill `description` triggers on the new decision vocabulary
      (modal/dropdown/floating-menu/drawer/overlay/"which animation") and still
      passes `skill-lint`.

**Component fix**

- [ ] `code/board.tsx`'s per-epic collapse/expand **animates with a slide** (height
      expand/collapse) in both directions, using an existing pattern/token (no new
      token), with `aria-hidden`/`inert` on the collapsed content and a
      `motion-reduce:` guard; collapse-all and the collapsed-set state behavior are
      unchanged.
- [ ] The remaining audited overlays still fade and the remaining in-flow
      disclosures still slide (no regressions); conforming components are untouched.
- [ ] The board change is covered by a test that would fail without it. Because the
      slide is CSS (not observable in jsdom), the primary evidence is a **Storybook
      image snapshot** (mid/expanded vs. collapsed board epic) with the approved
      baseline committed; optionally an RTL assertion that the collapsed region is
      `aria-hidden` / not in the accessibility tree (mirroring the subtask-list
      tests), and/or a Playwright check.

**General**

- [ ] `npm run lint:skills -w tools/skill-lint` is green and `npm run check` is
      green.
- [ ] A demo doc at `docs/demos/ALF-30.md` captures the board collapse/expand
      slide (before/after or the Storybook snapshot diff), per the repo workflow,
      and `npm run demo -- verify` passes. (Part A alone wouldn't need a demo, but
      Part B is a user-facing behavioral change, so the demo is required.)

## Out of scope / open questions

- **Normalizing overlay flourishes.** Per the refinement decision (pragmatic, not
  strict), `cascade-modal`'s zoom and `dropdown-menu`'s zoom + per-side slide-in
  are **kept** as allowed accents — *not* stripped to pure fades. A future ticket
  could decide to standardize them if desired.
- **New motion tokens / edge-drawer slide.** None are introduced; the board fix
  reuses the existing grid-rows pattern. If an edge drawer/sheet is ever added,
  authoring its slide token is a separate task.
- **Components in other categories.** Hover lift, ambient glow, the checkbox pop,
  and the completion animate-then-commit are unchanged — this ticket is only about
  the overlay-vs-disclosure default.
- **Open question — exact skill prose & section placement** are left to the
  implementing session, constrained by the acceptance criteria and `skill-lint`;
  the spec fixes the *content* (the mapping, the reconciliation, the stale-example
  correction) and the *one behavioral fix* (`board.tsx`), not the wording.
