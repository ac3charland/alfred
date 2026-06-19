---
name: frontend-architecture
description: >
  Documents the frontend's DRY and modular-component conventions: the shared primitive
  layer (components/atoms, lib/hooks, the store and route-handler factories), 
  when to extract a shared component or hook, and component size limits. 
  Use whenever refactoriing, and *especially* when adding, frontend code to avoid duplication. Trigger on:
  "Create a component to", "Add (UI feature) to the (tasks, code) module", "DRY this up", 
  "extract a component/hook", "is there already a component for this", "where should this live", 
  "decompose a huge component". Pairs with the data-flow skill (store/optimistic mechanics), 
  react (hooks/components), and shadcn-ui / tailwindcss (styling).
---

# Frontend architecture — DRY & the shared primitive layer

This skill is the standing guidance so frontendwork starts aligned instead
of adding copied code, hand-rolled components, or large, un-decomposed components.

## The one principle

Before you write UI, store, or route boilerplate, **check whether the shared layer already provides
it** — and the moment you're typing a *second* copy of something, that's the signal to extract, not
to paste. Duplication isn't just more lines: copies drift out of sync (a fix lands in one and not the
others), and concerns pile into one file until it's a 1100-line component no one can hold in their
head. Reuse keeps behavior and styling defined once.

If the shared layer doesn't already have what you need, **add it to the right layer and adopt it
everywhere — don't inline a fresh one-off.**

## Reach for the shared layer first (don't hand-roll)

**All shared presentational components live in one directory — `components/atoms/`.** There is no
separate `components/ui/`; a primitive's home is never a judgement call between two dirs — it's always
`atoms/`.

| You need… | Use | Not |
| --- | --- | --- |
| a button | `Button` (`components/atoms/button`) + a cva `variant` | a one-off `className` color override — add a variant instead |
| a dropdown menu item / content | `DropdownMenuItem` / `DropdownMenuContent` (`components/atoms/dropdown-menu`, already portal-wrapped) | re-typing the `flex … rounded-sm … hover:bg-secondary` item class |
| a dense inline single-line input | `TextField` (`components/atoms/text-field`) | a raw `<input>` with the teal-ring boilerplate |
| a full-width form field | `Input` (`components/atoms/input`) | (distinct from `TextField` — keep both) |
| a click-to-edit field | `EditableTextField` / `useInlineEdit` | reimplementing draft + Enter/Escape + blur + rollback per field |
| a modal | `FormDialog` / `DialogOverlay` | pasting `Dialog.Root → Portal → Overlay → Content` again |
| a pill / status chip | `Badge` variants | a bespoke `rounded-full px-2 …` span |
| an expand/collapse reveal | `AnimatedHeightCollapse` (+ the `motion` skill) | copying the `grid-rows-[0fr↔1fr]` transition block |
| a textarea + save/cancel | `TextareaField` | another textarea + two `Button`s inline |
| an active/inactive nav link class | the shared `navLinkClass` helper | a per-file copy of the same function |

When the difference between two usages is only a color or size, prefer **adding a cva variant** to
the existing component over forking a new one.

## Stores and route handlers have a shared spine too

The duplication isn't only in components.

- **Stores** — build the state+actions contexts and their guard hooks from the **context-pair
  factory**, and run each mutation through the shared **optimistic-mutation helper**. Don't hand-copy
  the capture → optimistic-update → `await` → reconcile/rollback sequence into every action. *The
  mechanics* of that sequence (the recipe, the per-id reconcile no-op, the rollback ref) are owned by
  the **`data-flow` skill** — read it for how the dance works; this skill's point is **use the
  factory, don't re-paste the dance.**
- **Route handlers** — parse and validate the body/query, build sparse PATCH updates, and map
  Supabase errors through the `lib/api` helpers (`parseRequestBody`, `parseQueryParams`,
  `toUpdatePayload`, `mapSupabaseError`, `parseUUID`) + the existing `withSession` / `jsonOk` /
  `jsonError`. The `try { await request.json() } catch … safeParse` block is not yours to retype in
  each handler. Read inline `supabase.from(...)` queries through `lib/data/*`, per `data-flow`.
- **Types** — input shapes come from the zod schemas via `z.infer` (`lib/api/schemas`). Don't
  re-declare a parallel `interface` that restates a schema; import the inferred type.

## When to extract — and where it goes

**Rule of two-or-three:** first instance, inline it. Second copy, take note. Third copy, extract —
earlier if the block is large or fiddly (a state machine, an animation, an auth guard). Extracting too
early invents an abstraction before you know its shape; extracting too late lets the copies drift.

Where the extracted thing lives:

- **any shared presentational component** (button, input, dialog, dropdown, badge, text-field,
  editable-text-field, collapse, empty-state, option-button) → **`components/atoms/`** — the single
  home; there is no `components/ui/`
- **reusable behavior / hook** (`useInlineEdit`, `useFormSubmit`, row-flag derivations) → `lib/hooks/`
- **store plumbing** (context-pair, optimistic-mutation, reducer actions) → `lib/stores/`
- **API plumbing** (request parsing, error mapping, param validation) → `lib/api/`
- **pure domain logic** (tree ops, launch labels, date utils) → `lib/**` (e.g. `lib/tree.ts`, `lib/code/`)

## Keep large components decomposed (conservatively)

A component that mixes layout **and** a dropdown menu **and** three inline editors **and** an exit
animation **and** data orchestration is doing too much — that's how `task-row` reached 1107 lines.
Pull **cohesive** units into their own files: behavior into hooks (item-type flags, animated
completion, indentation math), self-contained UI into sub-components (a meta panel, a row menu, an
epic block, manual controls), with the parent left as the composition root.

Keep it **conservative**: extract cohesive units, don't fragment every JSX fragment into its own file
or chase a line-count ceiling. Intentional recursion (a task rendering its subtasks) stays in place.

## Anti-patterns

- Copy-pasted Tailwind class clusters for menu items, dialogs, badges, or nav links.
- A hand-rolled Radix `Dialog` scaffold when `FormDialog` / `DialogOverlay` exist.
- Reimplementing the click-to-edit state machine (draft / Enter / Escape / rollback) per field.
- Re-typing the optimistic capture → `await` → reconcile/rollback in every store action.
- The request-parse / validate / error block copied across route handlers.
- A duplicate input-type `interface` that restates a zod schema.
- A 500+ line component owning five unrelated concerns.
- A helper (`navLinkClass`, `launchPhaseFor`) defined identically in two files.

## Before you introduce a new shared abstraction

First **search** for an existing one (`grep` `components/atoms`, `lib/hooks`,
`lib/api`, `lib/stores`). If you genuinely need a new shared piece, add it to the right layer **with a
test**, then **adopt it at every existing call site in the same change** — a half-adopted primitive
(new component used once, old copies left behind) is worse than none, because now there are *two*
patterns. An extraction preserves behavior — existing tests stay green with no assertion changes.

## Pointers

- **Store & optimistic mechanics** → the `data-flow` skill. **Hooks & component patterns** → `react`.
  **Primitive styling / cva / tokens** → `shadcn-ui` and `tailwindcss`. **Reveal/collapse motion** →
  the `motion` skill.
