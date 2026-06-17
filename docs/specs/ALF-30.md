# ALF-30 — Add animation guidance in a skill to default to fade in/out and slide open/close

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
("Fade + slide a panel in") suggests overlays can fade *and* slide, with no
stated default. The result is inconsistent choices across components — exactly
the "feels AI-generated" inconsistency restraint is meant to avoid.

The ticket asks us to encode a simple, opinionated default so every future
session animates the same category of thing the same way:

- **Modals / floating menus → fade in / fade out.**
- **Expansions / drawers → slide open / slide closed.**

The ticket left terminology to refinement ("settle on terminology in
refinement"); this spec settles it (see *Proposed change*).

This is a **skill/docs-only** change — guidance for agents, no app/source
behavior change. It lands in the existing `motion` skill rather than a new skill,
because that skill already owns this area of concern and a separate skill would
duplicate and fight it (per the compounding-learning rule: update the existing
skill for the area, don't spawn a near-duplicate).

## Terminology (settled)

Two categories, named so the mapping is unambiguous:

- **Overlay surface** — content rendered *above* the page (typically in a
  portal), transient and dismissible, **not** part of normal document flow, and
  it does **not** reflow surrounding content when it appears. Examples in this
  repo: dialogs/modals (`cascade-modal.tsx`, `story-detail-modal.tsx`, the
  `code/*-dialog.tsx` set), dropdown / context menus (`ui/dropdown-menu.tsx` and
  its users), popovers, tooltips, command palettes. The ticket's
  "modals / floating menus."
- **In-flow disclosure** — content that expands/collapses *within* the document
  flow, taking up space and pushing sibling content as it opens/closes. Examples:
  the inline subtask list (`task-row.tsx` grid-rows expand), the landing ⇆ inbox
  reveal (`inbox-screen.tsx`), accordions, collapsible panels, and edge drawers /
  sheets (a panel that slides in from a screen edge). The ticket's
  "expansions / drawers."

## Proposed change

Edit **`.claude/skills/motion/SKILL.md`** to add an explicit default-motion
mapping and weave it into the existing decision guidance. No other files change.

1. **Add a "Default motion by element type" section** (a short rule + table)
   near the top of the skill's decision material — directly after the existing
   "Decision Tree" section, before the "Plain-English → Pattern Table" — stating
   the defaults:

   | Element category | Default motion | Implement with (existing skill section) |
   |---|---|---|
   | **Overlay surface** (modal/dialog, dropdown/floating menu, popover, tooltip, command palette) | **Fade in / fade out** (opacity) | `--animate-fade-in` / `--animate-fade-out` tokens, or the fade reveal/collapse pattern when it mounts/unmounts |
   | **In-flow disclosure** (inline expansion, accordion, collapsible panel, edge drawer/sheet) | **Slide open / slide closed** (animate size/position, not just opacity) | grid-rows expand/collapse (`animate-expand-y` / `animate-collapse-y`, or the grid-rows transition) for height; a transform slide for an edge drawer |

   State the principle in one line so it generalizes beyond the table: **an
   overlay that floats over the page fades; content that opens within the page
   slides.**

2. **State the default explicitly, allow the documented exception.** Fade is the
   *through-line* for overlays; the existing "Fade + slide a panel in" compound
   (fade + a small `slide-in-from-*` via `tw-animate-css`) remains allowed as a
   directional flourish on an overlay, but **pure slide with no fade is wrong for
   an overlay**, and **pure fade with no size/position change is wrong for an
   in-flow disclosure** (a drawer that only fades reads as a popup, not a
   drawer). Make this reconciliation explicit so the compound row no longer reads
   as "overlays may slide instead of fade."

3. **Cross-link, don't duplicate.** The new section points at the already-written
   patterns (the fade reveal/collapse pattern, the grid-rows expand/collapse
   pattern, the animate-then-commit pattern) rather than re-explaining them — it
   adds the *which to choose* layer on top of the existing *how*.

4. **Reduced motion stays mandatory.** The new guidance must restate that every
   default still pairs with its `motion-reduce:` guard (`motion-reduce:animate-none`
   / `motion-reduce:transition-none`) per SPEC §5.4 — the default picks the motion
   *type*, it does not exempt anything from reduced-motion handling.

5. **Authoring constraints.** Because this edits a skill:
   - Read the `compounding-learning` skill first (house style: lean, current,
     right altitude, no duplication, no narration of the edit) — already required
     by CLAUDE.md.
   - The `description` frontmatter should gain the new trigger vocabulary
     (e.g. "modal", "dropdown", "floating menu", "drawer", "overlay", "which
     animation to use") so the skill loads when an agent is deciding how to
     animate one of these — without exceeding `skill-lint`'s description limits.
   - The edited `SKILL.md` must pass `skill-lint`
     (`npm run lint:skills -w tools/skill-lint`) — length, compound-toc, and
     description rules — exactly as the other skills do.

## Acceptance criteria

- [ ] `.claude/skills/motion/SKILL.md` contains a clearly-titled default-motion
      section mapping **overlay surfaces → fade in/out** and **in-flow
      disclosures → slide open/closed**, using the settled terminology above and
      naming concrete repo examples for each category.
- [ ] The section states the one-line generalizing principle (overlay → fade,
      in-flow → slide), not just the table.
- [ ] The existing "Fade + slide a panel in" guidance is reconciled with the new
      default: fade is the default for overlays, the compound slide is an allowed
      flourish, and pure-slide-overlay / pure-fade-drawer are called out as the
      wrong choices.
- [ ] The new guidance points to the existing patterns (fade reveal/collapse,
      grid-rows expand/collapse, animate-then-commit) instead of duplicating
      them.
- [ ] The new guidance restates the mandatory `motion-reduce:` pairing.
- [ ] The skill `description` is updated so the skill triggers on the new
      decision vocabulary (modal/dropdown/floating-menu/drawer/overlay/"which
      animation"), and still passes `skill-lint`.
- [ ] `npm run lint:skills -w tools/skill-lint` is green for the edited skill,
      and `npm run check` is green.
- [ ] No app/source/test changes are required by this change (it is
      agent-guidance only); if any incidental file is touched, it is the skill
      file (and, if warranted, a `docs/lint-suggestions/` note) only.

## Out of scope / open questions

- **No code refactor of existing components.** This ticket only writes the
  guidance. Auditing current modals/menus/expansions and migrating any that
  don't follow the new default is a **separate follow-up** — call it out, don't
  do it here. (If desired, that follow-up can be filed as its own ticket.)
- **No new motion tokens.** The defaults are expressed with the tokens/patterns
  that already exist (`--animate-fade-*`, `animate-expand-y` / `animate-collapse-y`,
  grid-rows transition, `tw-animate-css` slide). Adding an edge-drawer slide
  token, if one is ever needed, is out of scope here.
- **No demo doc required.** Per the repo workflow, a docs/skill-only change with
  no behavioral/user-facing effect does not need a `docs/demos/` entry. The
  evidence is `skill-lint` green plus the reviewed skill text.
- **Open question — section placement & exact wording** are left to the
  implementing session's judgment, constrained by the acceptance criteria and
  `skill-lint`; the spec fixes the *content* (the mapping + reconciliation), not
  the prose.
