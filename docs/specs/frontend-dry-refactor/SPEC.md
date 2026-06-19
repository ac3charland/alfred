# Frontend DRY & Modular-Architecture Refactor

> **Status:** Refinement spec. Hand to an implementation session (or a small swarm — phases are independently shippable).
> **Scope:** `frontend/` only. **Behavior-preserving** except two explicitly-flagged API behavior changes (Phase 4, D4 & D6).
> **Skills to read first:** `react`, `data-flow`, `shadcn-ui`, `tailwindcss`, `nextjs`, `supabase`, `typescript`, plus `react-testing-library` / `jest` / `playwright` for tests, `batch-commits` for committing, and `showboat` for demo docs.

## Context / problem

A five-domain audit of the frontend (tasks components, code-module components, stores/data-flow,
API route handlers, and the shared UI layer) found the architecture **sound** — it follows the
documented `data-flow` patterns, uses Radix/shadcn primitives, and separates concerns reasonably.
But it has accumulated **heavy copy-paste and missed reuse**: the same inline-edit interaction is
reimplemented ~5 times, the same Radix dialog scaffold 3 times, the same optimistic-mutation dance
~20 times across stores, and the same request-parse/validate boilerplate in 9 route handlers.
`task-row.tsx` alone is **1107 lines**.

This refactor extracts the shared abstractions, adopts them at every call site, and conservatively
decomposes the three largest components — **without changing user-visible behavior** (the two API
correctness fixes in Phase 4 are the only intended behavior deltas, and both are net-new rejections
of currently-malformed input).

### Guiding rules for the implementer (read before starting)

1. **Behavior-preserving by default.** Every extraction must leave existing tests green with **no
   assertion changes** beyond import-path/render-wrapper updates. If a refactor forces a test
   rewrite, you've changed behavior — stop and reconsider. The two exceptions are D4 and D6, which
   add new tests for new rejections.
2. **New components get a new test (CLAUDE.md TDD rule).** A new shared component/hook/helper gets its
   **own** unit/RTL test; adopting it at a call site is covered by that call site's existing tests
   (which must stay green). Note that all other tests must stay green while being unchanged; besides the
   noted exceptions, this is a refactor and not introducing any behavioral changes.
3. **Guardrails stay intact.** No `eslint-disable`, `@ts-expect-error`, `.skip`, config-weakening,
   or `--no-verify` (except the sanctioned `batch-commits` script). Fix the code, not the gate. If a
   rule genuinely misfits, file a `docs/lint-suggestions/` note and make the code pass as-is.
4. **One phase at a time.** Phases are ordered by dependency. Within a phase, make **one commit per
   extraction** (group by concern) using the `batch-commits` skill so the gate runs once.
5. **Demo doc per phase.** Each phase that changes a component's structure gets a
   `docs/demos/frontend-dry-refactor/<phase>.md` proving the UI is unchanged (screenshot the before
   from `main`, the after from the branch — they should match). Pure
   internal helper extraction (Phase 3/4 plumbing with no UI delta) don't need explicit demos; the
   before/after images are enough proof.
6. **Conservative decomposition (per the scoping decision).** Pull out cohesive hooks/sub-components;
   do **not** over-fragment into dozens of one-off files. Target readability, not a line-count
   contest.
7. **`'use client'` boundary.** All new shared components that use hooks/state are client components;
   keep the directive. Pure helpers (`lib/**`) stay server-safe (no React import unless they're hooks).

---

## Phase 1 — Shared UI primitives (Workstream A)

Create the reusable primitives and **adopt them at every call site** in the same phase. These unblock
Phase 2. **All shared presentational components live in one directory, `frontend/components/atoms/`
— there is no `components/ui/`** (see 1.0); new hooks live in `frontend/lib/hooks/`.

### 1.0 Consolidate the primitive layer: delete `components/ui/`, move everything into `components/atoms/` — **do first**

The repo previously split shadcn-style primitives (`components/ui/`) from alfred-specific pieces
(`components/atoms/`). That split is a judgement call with no payoff, so **collapse it to a single
home.** Before adding any new primitive:

- **Move** every file out of `frontend/components/ui/` into `frontend/components/atoms/` — today that's
  `button.tsx` (+ `button.stories.tsx`), `dropdown-menu.tsx`, `input.tsx`, `label.tsx` — and **delete
  the now-empty `components/ui/` directory.**
- **Update every import** (`@/components/ui/*` → `@/components/atoms/*`; ~10 files import from
  `components/ui` today) and any Storybook story paths / image-snapshot baselines that reference the
  old location.
- **Update `frontend/components.json`** so the shadcn `ui` alias points at the new home
  (`"ui": "@/components/atoms"`), so a future `npx shadcn add` writes into `atoms/` and doesn't
  recreate `ui/`.
- **Update the `shadcn-ui` skill** in the same step — its guidance that teaches importing from
  `@/components/ui/<name>` (and that `npx shadcn add` writes `components/ui/...`) must point at
  `components/atoms`, so the how-to matches the new single home. Do it here, where the move makes it
  true — not earlier, while `ui/` still exists.
- This is a pure move + re-point — **no behavior change**; existing tests/snapshots pass once paths are
  fixed. Every later step in this phase places its new primitive in `components/atoms/`.

> **Existing primitives to reuse (do not reinvent) — all in `components/atoms/` after 1.0:**
> `button.tsx` (cva `Button`), `dropdown-menu.tsx` (already exports a styled `DropdownMenuContent` —
> which **wraps its own `Portal`** — and `DropdownMenuItem`, `DropdownMenuSeparator`), `input.tsx`
> (`Input`), `label.tsx`, `text-field.tsx` (`TextField`, teal-ring inline input), `icon-button.tsx`,
> `spinner.tsx`; plus `lib/utils.ts` (`cn`).

### 1.1 `EditableTextField` + `useInlineEdit` hook (A1) — **High**

The single highest-leverage item; an existing `TODO` in `board.tsx` (~line 245) already requests it.
The "click a label → it becomes an input → Enter/blur saves, Escape cancels, a check button confirms,
errors roll the draft back" pattern is reimplemented in:

- `components/tasks/task-row.tsx` — title (~469–516), due-date, notes inline editors
- `components/code/board.tsx` — `EpicBlock` title (~243–280)
- `components/code/story-detail-modal.tsx` — `EditableTitle` (~102–189)
- `components/tasks/folder-nav.tsx` — `FolderNameForm` rename/create (~33–75)

**Create `frontend/lib/hooks/use-inline-edit.ts`:**

```ts
export interface UseInlineEdit {
  isEditing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  begin: () => void;          // seed draft from current value, enter edit mode
  cancel: () => void;         // reset draft, exit
  save: () => Promise<void>;  // trim; no-op if empty or unchanged; onSave then exit; rollback draft on throw
  inputRef: React.RefObject<HTMLInputElement | null>; // focus+select on enter
  inputProps: {              // spreadable convenience for the <input>
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void; // Enter→save, Escape→cancel
  };
}

export function useInlineEdit(
  currentValue: string,
  onSave: (next: string) => Promise<void> | void,
  options?: { selectAllOnEdit?: boolean }, // default true
): UseInlineEdit
```

Save semantics (preserve the existing behavior exactly): `const next = draft.trim()`; exit edit mode
first; if `next === '' || next === currentValue` reset draft to `currentValue` and return; else
`await onSave(next)` inside try/catch, and on throw reset draft to `currentValue` (optimistic-store
rollback already handles the store side).

**Create `frontend/components/atoms/editable-text-field.tsx`** — a presentational wrapper that wires
`useInlineEdit` to a display button + `TextField` + confirm `IconButton`, with a `render`/`children`
slot for the display-mode content so each call site keeps its own layout (epic ref suffix, pencil
icon, dialog title element, etc.):

```tsx
interface EditableTextFieldProps {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  label: string;                 // aria-label for the input + confirm button
  inputClassName?: string;       // sizing/typography (flex-1, text-lg, py-0.5…)
  selectAllOnEdit?: boolean;
  children?: React.ReactNode;    // display-mode content; defaults to {value}
}
```

**Adopt at all four call sites.** `folder-nav`'s form also handles **create** (empty initial value)
and renders inside a `<form>` — keep that wrapper but drive its input/state through `useInlineEdit`
(or, if create-mode diverges too much, use `useInlineEdit` for rename only and leave create on the
existing local state; document which). The `board.tsx` `TODO` comment is **removed** as part of this.

**Tests:** new `use-inline-edit.test.ts(x)` (begin/cancel/save, empty→no-op, unchanged→no-op,
throw→rollback, Enter/Escape) and `editable-text-field.test.tsx` (display→edit→save round trip via
`user-event`). Existing task-row / board / story-detail / folder-nav tests stay green.

### 1.2 `AnimatedHeightCollapse` (A2) — **Medium**

The `grid` + `grid-template-rows: 0fr↔1fr` height transition is copied 4×:
`task-row.tsx` (~363–372, ~963–972, ~1012–1019) and `inbox-screen.tsx` (~102–114).

**Create `frontend/components/atoms/animated-height-collapse.tsx`:**

```tsx
interface AnimatedHeightCollapseProps {
  open: boolean;
  children: React.ReactNode;
  onTransitionEnd?: (e: React.TransitionEvent<HTMLDivElement>) => void; // filtered to own element
  className?: string; // applied to the inner overflow-hidden wrapper
}
```

Renders `<div className="grid transition-[grid-template-rows] duration-200 ease-out
motion-reduce:transition-none {open?'grid-rows-[1fr]':'grid-rows-[0fr]'}"><div className="overflow-hidden">…`.
The `onTransitionEnd` **must filter to `e.propertyName === 'grid-template-rows'` and
`e.target === e.currentTarget`** so nested collapses don't cross-fire (task-row's completion-collapse
relies on this — see A's task audit Finding 2 and the `motion` skill). Preserve the existing 200ms /
`ease-out` timing.

**Adopt at all 4 call sites.** **Tests:** `animated-height-collapse.test.tsx` (renders children;
`open` toggles the `grid-rows-*` class; `onTransitionEnd` only fires for the matched property — mock
the event). Keep the `motion` skill's jsdom `matchMedia` note in mind for reduced-motion.

### 1.3 `FormDialog` + shared `DialogOverlay` (A3) — **High**

The Radix `Dialog.Root → Portal → Overlay → Content` scaffold (with the same overlay blur + content
animation classes) is copy-pasted in `new-project-dialog.tsx` (~180–202), `new-epic-dialog.tsx`
(~113–135), `gate-dialog.tsx` (~282–301); the overlay alone is also duplicated in
`cascade-modal.tsx` (~33) and `shell/shell-mobile-nav.tsx` (~37).

**Create `frontend/components/atoms/dialog.tsx`** exporting:

- `DialogOverlay` — the shared `fixed inset-0 … bg-black/60 backdrop-blur-sm … animate-in/out …
  motion-reduce:animate-none` overlay. Note the two existing overlays use slightly different
  z-indexes (`z-50` vs `z-[55]`) — expose a `className` override so both can adopt it without a
  visual change; **do not unify the z-index** (that would be a behavior/stacking change).
- `FormDialog` — `Root → Portal → DialogOverlay → Content` with a `maxWidth` variant
  (`'md' | 'lg' | '2xl'`) and `onOpenAutoFocus` preventable, matching today's per-dialog values
  (project/epic = `md` `z-[55]`, gate = its current width, story-detail = `2xl` `z-50`). Keep
  `onOpenAutoFocus={(e) => e.preventDefault()}` where the originals have it.

**Adopt:** the three code dialogs wrap their form bodies in `FormDialog`; `cascade-modal` and
`shell-mobile-nav` swap their hand-rolled overlay for `DialogOverlay` (same z-index via `className`).
**Do not** force `story-detail-modal` into `FormDialog` if its content shell diverges materially —
at minimum reuse `DialogOverlay`. **Tests:** `dialog.test.tsx` (renders children when open, overlay
present, `maxWidth` maps to the right class); existing dialog/modal tests stay green (same rendered
output).

### 1.4 Reuse `DropdownMenuItem` / `DropdownMenuContent` (A4) — **High**

`task-row.tsx` (~634–805) and `folder-nav.tsx` (~226–262) hand-roll `DropdownMenu.Content` /
`DropdownMenu.Item` className strings (the `flex cursor-pointer select-none items-center rounded-sm
px-3 py-2 … hover:bg-secondary focus:bg-secondary` pattern, 14+ times) **even though
`components/atoms/dropdown-menu.tsx` already exports styled `DropdownMenuContent` and
`DropdownMenuItem`**. Replace the raw `DropdownMenuPrimitive`/inline-class usages with the exported
components.

- Add a **`variant`** to `DropdownMenuItem` via cva: `default` and `destructive`
  (`text-destructive focus:text-destructive`) so the Delete items drop their inline override.
- Add a styled **`DropdownMenuSubTrigger`** and **`DropdownMenuSubContent`** export to
  `dropdown-menu.tsx` (task-row's classify/move submenus use raw primitives today) so submenus match.
- Note `DropdownMenuContent` already renders its own `Portal`; remove now-redundant manual `Portal`
  wrappers at call sites.

**Tests:** extend `dropdown-menu.test.tsx` (or add one) for the `destructive` variant + sub-trigger
styling; task-row/folder-nav menu tests stay green (same items, same a11y roles).

### 1.5 `Badge` component (A5) — **Medium**

Four competing pill styles: `tasks/type-badge.tsx` (~26), the two count badges in `task-row.tsx`
(~580, ~589), and `StateChip` in `story-detail-modal.tsx` (~65–81).

**Create `frontend/components/atoms/badge.tsx`** with a cva: base `shrink-0 rounded-full px-2 py-0.5
text-xs font-medium` and variants `muted` (border, `text-muted-foreground`), `secondary`
(`bg-secondary`), `accent` (`bg-accent-teal/15 text-accent-teal`), `alert` (amber), `destructive`.
Refactor `type-badge` to render `<Badge variant="muted">`, the count badges to `secondary`/`muted`
(the completed one keeps its `<Check size={10}>` child), and rewrite `StateChip` to delegate to
`Badge` (it adds `uppercase tracking-wide font-semibold` via `className` — keep that). **Preserve
each badge's exact current classes** (verify against a screenshot). **Tests:** `badge.test.tsx`
variant→class mapping; existing type-badge/state-chip tests stay green.

### 1.6 Button `accent` variant (A6) — **Medium**

`bg-accent-teal text-background hover:bg-accent-teal/90` is appended to `Button` className on ~6 CTAs
(`capture-box` ×2, `cascade-modal`, the three code dialogs' confirm buttons, story-detail launch).
Add `accent: 'bg-accent-teal text-background hover:bg-accent-teal/90'` to the `buttonVariants` cva in
`components/atoms/button.tsx` and switch those call sites to `<Button variant="accent">`, dropping the
inline className (keep any per-site `disabled:opacity-40` only if it differs from the cva base
`disabled:opacity-50` — prefer the base; if a site truly needs 40, note it). **Tests:** extend
`button.test.tsx` for the `accent` variant; call-site tests stay green.

### 1.7 Extract `navLinkClass` (A7) — **Low**

Identical helper duplicated verbatim in `tasks/folder-nav.tsx` (~20–30) and `code/project-nav.tsx`
(~20–27). Move to **`frontend/lib/ui/nav-link-class.ts`** (exported `navLinkClass(active: boolean)`)
and import in both. **Tests:** trivially covered by the two navs' existing tests; add a tiny unit
test asserting active vs inactive class membership.

### 1.8 `TextareaField` atom (A8) — **Medium**

The "textarea + Save/Cancel buttons" block is duplicated in `board.tsx` epic-notes (~91–127) and
`story-detail-modal.tsx` block-reason (~319–359). **Create
`frontend/components/atoms/textarea-field.tsx`**:

```tsx
interface TextareaFieldProps {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  label?: string;
  placeholder?: string;
  rows?: number;            // default 2
  isPending?: boolean;
  saveLabel?: string;       // default 'Save'
  cancelLabel?: string;     // default 'Cancel'
  variant?: 'default' | 'warning'; // border/bg for the block-reason amber treatment
}
```

Reuse `Button variant="ghost"`/`accent` for the actions. Adopt at both sites (epic-notes = `default`
`saveLabel="Save"`; block-reason = `warning` `label="Why is this blocked? (optional)"`
`saveLabel="Confirm block"`). **Tests:** `textarea-field.test.tsx`; existing board/story-detail tests
stay green.

### 1.9 `useFormSubmit` hook (A9) — **Medium**

The `error`/`isSaving`/`try-catch`→`onSuccess` submit flow repeats in all three code dialogs
(`new-project` ~43–77, `new-epic` ~33–55, `gate`). **Create `frontend/lib/hooks/use-form-submit.ts`:**

```ts
export function useFormSubmit<T>(opts: {
  onSubmit: () => Promise<T>;
  onSuccess: (result: T) => void;
  errorMessage: string;
}): { error: string | null; isPending: boolean; submit: () => Promise<void> };
```

Semantics match today: `setError(null); setIsPending(true)`; on success call `onSuccess` (caller
closes the dialog); on throw `setError(errorMessage); setIsPending(false)`. Adopt in all three forms;
each keeps its own field state and `canSubmit` (now `… && !isPending`). **Tests:**
`use-form-submit.test.tsx` (success path calls onSuccess, error path sets message + clears pending);
dialog tests stay green.

### 1.10 Smaller wins (A10) — **Low**

- **`EmptyState`** (`components/atoms/empty-state.tsx`): the centered `py-16` "title + subtitle" block in
  `task-list.tsx` (~72–79) and `folder-view.tsx` (~24–29). Props `{ title; description? }`. Adopt at
  both; preserve `font-serif`/muted classes. Add `empty-state.test.tsx`.
- **`OptionButton`** (`components/atoms/option-button.tsx`): the `OptionRow`/`AddNewRow` selectable
  rows in `gate-dialog.tsx` (~36–89) share a focus-ring + selected-bg pattern. Extract a cva
  (`selected: true|false`) atom and use it for both. Covered by gate-dialog tests.
- **`InlineTextForm`**: optional — if `useInlineEdit` (1.1) already absorbs `folder-nav`'s
  create/rename form cleanly, **skip** this to avoid an extra one-off abstraction.

**Phase 1 acceptance**

- [ ] New primitives exist with their own tests: `useInlineEdit`, `EditableTextField`,
      `AnimatedHeightCollapse`, `FormDialog`/`DialogOverlay`, `Badge`, `TextareaField`, `useFormSubmit`,
      `EmptyState`, `OptionButton`; `Button` gains `accent`; `DropdownMenuItem` gains `destructive` +
      sub-trigger/content exports; `navLinkClass` is shared.
- [ ] Every listed call site adopts the new primitive; the hand-rolled duplicate (inline classes,
      raw dialog scaffold, copied helpers) is gone. The `board.tsx` inline-edit `TODO` is removed.
- [ ] **No visual change.** A demo doc shows before (main) ≈ after (branch) screenshots of the inbox,
      a folder view, the code board, a code dialog, and the story-detail modal.
- [ ] **Ratchet enforced (see Regression ratchet):** this PR adds `no-raw-html-button-input` and
      `no-raw-radix-dialog-dropdown`, promoted to `error` once the call sites are migrated.
      (See [## Regression ratchet — the lint rule each phase enforces](#regression-ratchet-the-lint-rule-each-phase-enforces))
- [ ] `check` is green with **no changes to existing test assertions** beyond import/render-wrapper
      updates.

---

## Phase 2 — Decompose the large components (Workstream B, "extract logic only")

Depends on Phase 1 primitives. **Conservative depth:** pull out cohesive hooks and sub-components;
keep each parent file as the composition root. Do **not** chase a line ceiling or split every JSX
fragment into its own file.

### 2.1 `task-row.tsx` (1107 lines → composition root) — **High**

Extract, in this order, reusing Phase 1 where noted:

- **Hooks → `frontend/lib/hooks/`:**
  - `useTaskRowFlags(node, isCompleted, draggedSubtreeIds)` → `{ isTask, isUnclassified, isCode,
    canConvert, isValidDropTarget }` (task audit Finding 5).
  - `useAnimatedCompletion(onComplete, prefersReducedMotion)` → encapsulates the `isCompleting`
    state, the `hasCompletedRef`/`isCompletingRef` double-fire guards, the unmount-fallback effect,
    and the collapse-end handler (task audit Finding 9). **This is delicate** — preserve the
    once-only mutation fire and the navigate-away fallback exactly; cover with a focused test.
  - `useIndentation(depth)` → the `depth * 1.25 + …` rem calculations used at ~204, ~985, ~1044
    (task audit Finding 11).
- **Sub-components → `frontend/components/tasks/task-row/`:**
  - `TaskMetaPanel` — the inline due-date + notes card (~809–961), built on `EditableTextField`
    (date/notes) and `AnimatedHeightCollapse`.
  - `TaskRowMenu` — the whole dropdown (~627–805), now using the reused `DropdownMenuItem`/sub-trigger
    from 1.4. Keep visibility conditionals (`isUnclassified`/`isCode`/`canConvert`/`isTask`/folders)
    inside this component.
  - The three inline editors collapse into `EditableTextField` usages (title) /
    `TaskMetaPanel` (date, notes).
- **Recursive child rendering** (`TaskRow` rendering child `TaskRow`s, ~963–1071) stays in the parent
  via `AnimatedHeightCollapse` — recursion is intentional (`react` skill).

Target: `task-row.tsx` becomes the row layout + composition (~roughly 400–500 lines), with the meta
panel, menu, and hooks in their own files. **Standardize handler names** to `handle<Action>` while
moving them (task audit Finding 13) — cosmetic, do it in the same commits.

### 2.2 `board.tsx` (549) — **Medium**

Extract to `frontend/components/code/board/`:
- `ToggleButton` (~42–67) — pill filter toggle (or `components/atoms/` if reused elsewhere).
- `EpicBlock` (~152–381) with its `EpicHeaderActions` (epic title via `EditableTextField`, notes via
  `TextareaField`). `Board` stays the orchestrator (epic list + collapse/filter state + modal wiring).

### 2.3 `story-detail-modal.tsx` (522) — **Medium**

Extract to `frontend/components/code/story-detail/`:
- `PrimaryAction` (~197–233), `ManualControls` (~235–362, includes the block-reason `TextareaField`
  from 1.8), `SpecBody` (~365–393). `EditableTitle` becomes `EditableTextField` (1.1). The
  `launchPhaseFor`/`LAUNCH_LABELS` here move to `lib/code/launch.ts` in Phase 5 (E2) — leave a note,
  or do E2 first since it's tiny. `StoryDetailModal` stays the composition root.

**Phase 2 acceptance**

- [ ] `task-row.tsx`, `board.tsx`, `story-detail-modal.tsx` are decomposed into the named hooks/
      sub-components; each parent is a readable composition root.
- [ ] Completion animation + double-fire guard + navigate-away fallback behavior is **unchanged**
      (covered by a `useAnimatedCompletion` test and the existing task-row completion tests/e2e).
- [ ] **Ratchet enforced (see Regression ratchet):** this PR adds `max-lines-components` (kept a
      `warn` — the deliberate exception), tuned to the post-decomposition norm.
      (See [## Regression ratchet — the lint rule each phase enforces](#regression-ratchet-the-lint-rule-each-phase-enforces))
- [ ] No visual or interaction change; demo doc shows the task tree (expand/collapse, inline edit,
      complete-with-cascade), the board, and the story modal behaving identically. `check` green.

---

## Phase 3 — Store / data-flow factories (Workstream C)

Independent of Phases 1–2. Read the `data-flow` skill first; **do not change the read→store→write
architecture or the optimistic/reconcile/rollback semantics** — only factor out the boilerplate.

### 3.1 `createContextPair` factory (C1) — **High**

All six stores (`tasks`, `folders`, `code`, `expansion`, `active-editor`, `toast`) hand-roll a
state-context + actions-context pair plus two `useContext` guard hooks that throw "must be used
within a Provider". **Create `frontend/lib/stores/create-context-pair.ts`:**

```ts
export function createContextPair<State, Actions>(displayName: string): {
  StateContext: React.Context<State | undefined>;
  ActionsContext: React.Context<Actions | undefined>;
  useStateValue: () => State;   // throws `${displayName} ...` if outside provider
  useActions: () => Actions;
};
```

Refactor each store to build its contexts/hooks from the factory, keeping each store's **public hook
names unchanged** (`useTasks`, `useTaskActions`, `useFolders`, …) by aliasing the factory output.
**Tests:** factory unit test (throws outside provider, returns value inside); existing store tests
stay green (same hook names, same throw messages — keep the message text stable or update the few
tests that assert it).

### 3.2 `createOptimisticMutation` helper (C2) — **High**

The capture-prior → optimistic-dispatch → await-API → reconcile-or-rollback sequence repeats ~20×
across `tasks-store` (~144–315), `folders-store` (~102–135), `code-store` (~358–537). **Create
`frontend/lib/stores/optimistic-mutation.ts`** — a typed helper that takes the current-state ref, an
id, the optimistic dispatch, the API call, and reconcile/rollback strategies, and runs the dance once.
Design it to cover the three existing rollback shapes (full-row `upsert([prev])`, selective-field
`patch`, and folders' position-aware `insertAt`) via options — see the stores audit Finding 2/6 for
the proposed signature. Migrate the single-item edit actions first (highest duplication, lowest risk),
then the subtree/position ones. **Preserve each action's exact optimistic + rollback effect.**
**Tests:** `optimistic-mutation.test.ts` (reconcile path, rollback-on-throw, each strategy); all
existing store action tests stay green.

### 3.3 Unify reducer actions + shared helpers (C3, C4) — **Medium/Low**

- Extract a generic `frontend/lib/stores/reducer-actions.ts` with the common
  `insert | replace | patch | upsert | remove` action union + a `simpleReducer<T extends {id}>` and
  add `insertAt` for folders' ordered rollback. Have `tasks`/`folders` stores use it; for `code-store`
  evaluate folding its per-entity actions (`patchEpic`/`patchStory`/…) into the generic shape — if
  that balloons the diff or hurts clarity, **keep code-store's per-entity reducer** and just note it
  (conservative-decomposition principle applies to stores too).
- Move `assertNever` (duplicated in 3 stores) to `frontend/lib/stores/assert-never.ts` with a
  `context` arg. Move `tempId()` and the optimistic-row generators (`makeOptimisticFolder/Project/
  Epic/Story`) next to the existing `makeOptimisticItem` in `lib/tree.ts` (export them; replace the
  private copies + the duplicated `tempId` in `code-store`).

**Tests:** `simpleReducer` and `assert-never` unit tests; store tests stay green.

### 3.4 Document rollback strategy (C5) — **Low**

Add a short "which rollback strategy to use (full / selective / position-aware)" note to the
`data-flow` skill (per the compounding-learning rule — read that skill first). No code change.

**Phase 3 acceptance**

- [ ] `createContextPair`, `createOptimisticMutation`, `simpleReducer`, `assertNever`, shared
      `tempId`/optimistic generators exist with tests; the six stores use the context factory and the
      mutation helper (code-store's per-entity reducer may stay if folding it hurts clarity — note the
      decision).
- [ ] **Ratchet enforced (see Regression ratchet):** this PR adds `no-inline-supabase-from` and
      `no-duplicate-helper-names`, promoted to `error` once verified clean.
      (See [## Regression ratchet — the lint rule each phase enforces](#regression-ratchet-the-lint-rule-each-phase-enforces))
- [ ] All existing store/action tests pass **unchanged**; the optimistic + reconcile/rollback behavior
      is provably identical. `data-flow` skill gains the rollback-strategy note. `check` green.

---

## Phase 4 — API route handler DRY + correctness (Workstream D)

Independent of other phases. Read `nextjs` + `supabase` skills. New plumbing lives in `frontend/lib/api/`.
Reuse existing `lib/api/responses.ts` (`jsonOk`/`jsonError`) and `lib/api/auth.ts` (`withSession`,
`resolveIngestClient`).

### 4.1 `parseRequestBody(request, schema)` (D1) — **High**

The `try { body = await request.json() } catch { jsonError(400,'Invalid JSON body') }` +
`schema.safeParse` → `jsonError(400,'Invalid request body', issues)` block repeats in **9** POST/PATCH
handlers (items, folders, folders/[id], items/[id], epics, epics/[id], code, code/[ref], projects).
**Add to `frontend/lib/api/parsing.ts`:**

```ts
export async function parseRequestBody<T>(
  request: Request, schema: z.ZodType<T>, errorMessage?: string,
): Promise<T | Response>; // returns parsed data, or a 400 Response
```

Handlers call it and early-return when the result `instanceof Response`. **Tests:** `parsing.test.ts`
(invalid JSON → 400, schema failure → 400 with issues, success → data); existing route tests stay green.

### 4.2 `parseQueryParams(request, schema)` (D2) — **Medium**

The URL→raw-object→`safeParse` block in the `items` and `epics` GET handlers. Add to the same
`parsing.ts`. **Tests:** add cases; route GET tests stay green.

### 4.3 `toUpdatePayload(data, fields)` (D3) — **Medium**

The `if (d.x !== undefined) updates.x = d.x` loops in the items/epics/code PATCH handlers. **Create
`frontend/lib/api/updates.ts`:** `toUpdatePayload<T>(data, fieldNames: (keyof T)[]): Partial<T>`.
Replace the manual blocks. **Tests:** `updates.test.ts` (only-defined-fields copied); route tests
stay green.

### 4.4 `mapSupabaseError` — consistent error codes (D4) — **Medium, BEHAVIOR CHANGE**

Today only `/api/projects` maps Postgres `23505` (unique violation) → **409**; every other handler
returns **500** for any Supabase error. **Create `frontend/lib/api/supabase-errors.ts`:**

```ts
export function mapSupabaseError(error: PostgrestError): { status: number; message: string };
// 23505 → 409, 23503 (FK) → 400, default → 500
```

Apply in **all** route handlers' error branches (including projects, which keeps its 409). **This is
an intended behavior change:** unique-constraint violations now return 409 instead of 500 across
resources, and FK violations return 400. **Tests (new):** a handler test asserting a simulated 23505
→ 409 and a 23503 → 400 (mock the Supabase error); the existing projects 409 test stays green;
generic-500 tests for non-mapped codes stay green.

### 4.5 Move inline GET queries into `lib/data/*` (D5) — **Low**

GET handlers build Supabase queries inline instead of calling the data layer the `data-flow` skill
prescribes. Extend `lib/data/items.ts` (and peers) with parameterized readers (e.g.
`getItems(query: ListItemsQuery)`) and have the GET handlers call them. Keep the
`.overrideTypes<…>()` typing. **Tests:** data-layer reader unit tests (or keep coverage via the
existing route tests if mocking the data layer is cleaner); route behavior unchanged.

### 4.6 `parseUUID` path-param validation (D6) — **Low, BEHAVIOR CHANGE**

Dynamic-segment handlers (`items/[id]`, `folders/[id]`, `epics/[id]`, `code/[ref]`,
`tasks/[id]/complete`) await `context.params` and query with the raw id, so a malformed id silently
matches nothing and returns success. **Create `frontend/lib/api/params.ts`:**
`parseUUID(value, field?) → string | Response` (400 on invalid). Apply where the segment is a UUID
(`[ref]` may be a human ref like `ALF-42` — **only** UUID segments get this; document which). **This
is an intended behavior change:** malformed UUIDs now 400 instead of a silent 200/no-op. **Tests
(new):** invalid id → 400; valid id → existing behavior; existing per-route tests stay green.

**Phase 4 acceptance**

- [ ] `parseRequestBody`, `parseQueryParams`, `toUpdatePayload`, `mapSupabaseError`, `parseUUID`
      exist with tests and are adopted across the route handlers; the 9 parse blocks, the PATCH
      undefined-loops, and the ad-hoc 500s are gone.
- [ ] **Behavior deltas (intended, tested):** unique-violation → 409 / FK → 400 across resources;
      malformed UUID path params → 400. New tests assert each; all other route tests pass unchanged.
- [ ] **Ratchet enforced (see Regression ratchet):** this PR adds `no-direct-request-json-in-routes`,
      promoted to `error` once all nine handlers are migrated.
      (See [## Regression ratchet — the lint rule each phase enforces](#regression-ratchet-the-lint-rule-each-phase-enforces))
- [ ] GET handlers read through `lib/data/*`. `check` green; a demo doc shows the new 409/400
      responses via `curl`/`exec` against the dev server.

---

## Phase 5 — Cross-cutting type & util unification (Workstream E)

Tiny, independent; can be folded into Phase 1 (E2) and Phase 4 (E1) or shipped standalone.

- **E1 — Input-type unification.** `lib/api-client.ts` re-declares `CreateItemInput`/`UpdateItemInput`/
  etc. that `lib/api/schemas.ts` already produces via `z.infer`. Delete the hand-written interfaces
  and `import type { … } from '@/lib/api/schemas'` (re-export for existing importers). **Single source
  of truth.** Type-check + existing tests cover it; no runtime change.
- **E2 — `lib/code/launch.ts`.** `launchPhaseFor` + `LAUNCH_LABELS` are defined identically in
  `code/story-card.tsx` and `code/story-detail-modal.tsx`. Move to `lib/code/launch.ts`; import in
  both. Add a small unit test for `launchPhaseFor`.

**Phase 5 acceptance**

- [ ] `api-client.ts` imports its input types from `schemas.ts` (no duplicate interfaces);
      `launchPhaseFor`/`LAUNCH_LABELS` live in `lib/code/launch.ts` and both code components import
      them. `check` green.

---

## Regression ratchet — the lint rule each phase enforces

Extracting a primitive removes today's duplication; the **lint rule the same phase ships** keeps it
gone. The rule is the ratchet, and it tightens **as each anti-pattern is fixed**: the phase that
introduces a shared replacement is also the phase that bans the hand-rolled form. Enforcement model,
applied **within each phase's own PR**:

1. **Add the rule with the phase that creates its replacement — never before.** A rule forbidding
   something with no sanctioned alternative just blocks people; once the primitive/helper exists, the
   hand-rolled form is mechanically catchable.
2. **Start it as `warn` while you migrate the call sites, then promote it to `error` in the same PR
   once those sites are clean.** The phase lands with the regression *locked out* (an `error`), not
   deferred to a someday cleanup — that's what "ratchet it and enforce the rule" means. The one
   exception is `max-lines-components`, which stays a `warn` (a large file is sometimes justified;
   like skill-lint's `body-length`, it's a tripwire, not a hard limit).

These are **deliberate project-rule additions** — the legitimate kind the back-pressure rules carve
out, *not* a guardrail bypass — and use **core ESLint only** (`no-restricted-syntax`,
`no-restricted-imports`, `max-lines`; no new dependency), wired into `frontend`'s `check:fast` via the
existing flat config. Read the `eslint` and `backpressure` skills before wiring them.

**Flat-config caveat:** `no-restricted-syntax` options **replace**, they don't merge, across
overlapping `files` globs. The selectors that target `components/**` (`no-raw-html-button-input`,
`no-inline-supabase-from`, `no-duplicate-helper-names`) must be **combined into one
`no-restricted-syntax` entry per file-scope**, not split across config blocks, or the later block
silently wins and drops the earlier selectors.

### Phase 1 — `no-raw-html-button-input`

Feature components hand-roll raw `<button>`/`<input>`/`<textarea>` (duplicated focus-ring / accent /
dense-input classes) instead of `Button`, `IconButton`/`TextField`, and the new `TextareaField`.

```js
{ files: ['frontend/components/{tasks,code,shell,auth}/**/*.tsx'],
  rules: { 'no-restricted-syntax': ['warn',
    { selector: "JSXOpeningElement[name.name='button']",   message: 'Use <Button> or <IconButton> — not a raw <button>.' },
    { selector: "JSXOpeningElement[name.name='input']",    message: 'Use <TextField> or <Input> — not a raw <input>.' },
    { selector: "JSXOpeningElement[name.name='textarea']", message: 'Use <TextareaField> — not a raw <textarea>.' },
  ] } }
```

Exempt the primitives themselves (`components/atoms/**` — it renders the raw elements) and
tests/stories/e2e. Promote to `error` once the feature dirs are migrated.

### Phase 1 — `no-raw-radix-dialog-dropdown`

The Radix `Dialog.Root → Portal → Overlay → Content` scaffold and hand-typed `DropdownMenu` item
classes, once `FormDialog`/`DialogOverlay` and the styled `DropdownMenu*` exports exist.

```js
{ files: ['frontend/components/**/*.tsx'], ignores: ['frontend/components/atoms/**'],
  rules: { 'no-restricted-imports': ['error', { paths: [{
    name: 'radix-ui', importNames: ['Dialog', 'DropdownMenu'],
    message: 'Import the styled wrapper from components/atoms (FormDialog/DialogOverlay, DropdownMenu*) — not the raw Radix primitive.',
  }] }] } }
```

Can land straight at `error` — `components/atoms/**` (the primitive layer that wraps Radix) is the
only legitimate importer and is exempt. A future need with no wrapper means *add a wrapper*, so
strictness is correct.

### Phase 2 — `max-lines-components` (stays `warn`)

A file-length tripwire so the next component sliding toward `task-row`'s 1107 lines is flagged.

```js
{ files: ['frontend/components/**/*.tsx'],
  rules: { 'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }] } }
```

Tune `max` after the three large components are decomposed, so the ceiling reflects the post-refactor
norm. Keep it `warn` (the deliberate exception to the promote-to-`error` rule above).

### Phase 3 — `no-inline-supabase-from`

Mechanizes the existing `data-flow` convention (reads → `lib/data/*`; writes → store action → route
handler), reinforced by moving GET queries into `lib/data/*` in Phase 4.

```js
{ files: ['frontend/components/**/*.{ts,tsx}', 'frontend/lib/stores/**/*.{ts,tsx}'],
  rules: { 'no-restricted-syntax': ['warn', {
    selector: "CallExpression[callee.property.name='from'][callee.object.name='supabase']",
    message: 'No Supabase here: reads → a lib/data/* reader; writes → a store action → route handler.',
  }] } }
```

Exempt the one sanctioned client user, `components/auth/login-form.tsx`. The `[callee.object.name=
'supabase']` guard keeps it from matching `Array.from` etc.; accept that narrowness (the general catch
is the copy-paste audit). Promote to `error` once verified clean.

### Phase 3 — `no-duplicate-helper-names`

Exact tripwire for the known duplicated helpers, once each has a canonical home.

```js
{ files: ['frontend/**/*.{ts,tsx}'],
  ignores: ['frontend/lib/stores/assert-never.ts', 'frontend/lib/tree.ts', 'frontend/lib/ui/nav-link-class.ts'],
  rules: { 'no-restricted-syntax': ['warn',
    { selector: "FunctionDeclaration[id.name='assertNever']", message: 'Import assertNever from lib/stores/assert-never.' },
    { selector: "FunctionDeclaration[id.name='tempId']",      message: 'Import tempId from lib/tree.' },
    { selector: "VariableDeclarator[id.name='navLinkClass']", message: 'Import navLinkClass from lib/ui/nav-link-class.' },
  ] } }
```

By-name only (a renamed copy slips through — the copy-paste audit is the general catch). Promote to
`error` once the duplicates are removed.

### Phase 4 — `no-direct-request-json-in-routes`

After `parseRequestBody` exists, a bare `request.json()` in a handler means the parse boilerplate was
re-inlined.

```js
{ files: ['frontend/app/api/**/route.ts'],
  rules: { 'no-restricted-syntax': ['warn', {
    selector: "CallExpression[callee.property.name='json'][callee.object.name='request']",
    message: 'Parse + validate via parseRequestBody(request, schema) — not request.json() directly.',
  }] } }
```

Scope is `app/api/**/route.ts` only (no collision with the `components/**` selectors). Promote to
`error` once all nine handlers are migrated.

### Beyond the named rules

The *behavioral* duplications (the inline-edit state machine, the optimistic
capture→reconcile/rollback dance, context-pair scaffolding) and literal copy-paste blocks (the
`grid-rows` transition, the dialog scaffold, duplicated helper *bodies*) can't be caught by a single
AST rule. A token-level copy-paste detector covers the literal cases generically — speced separately
in [`docs/specs/duplication-audit/SPEC.md`](../duplication-audit/SPEC.md) as a non-blocking
`audit:dupes` script. The behavioral ones stay the province of the `frontend-architecture` skill and
review.

---

## Sequencing & dependencies

1. **Phase 1** (UI primitives) — do first; unblocks Phase 2. Each sub-item (1.1–1.10) is an
   independent commit; ship the phase as one PR.
2. **Phase 2** (decomposition) — after Phase 1.
3. **Phase 3** (stores) and **Phase 4** (API) — independent of 1/2 and of each other; can run in
   parallel by separate teammates.
4. **Phase 5** — fold E2 into Phase 1/2 (story components) and E1 into Phase 4, or ship as a small
   standalone PR.

Suggested PR set: `feat(atoms): shared primitives`, `refactor(tasks): decompose task-row` (+ board +
story-detail, possibly split), `refactor(stores): context + optimistic factories`,
`refactor(api): request-parsing + error helpers`, `refactor(types): unify api input types`. Use
Conventional-Commit one-liners (scope required, lowercase, no body) per `commitlint`.

## Out of scope — leave as-is (intentional per the `data-flow` skill)

- **`scope` prop into `TaskList`** and **`onOpenSession` threading** Board→Swimlane→Card — explicit,
  testable prop-passing the skill endorses; do **not** convert to context.
- **`lib/data/*` empty-array-on-null fallback** — deliberate graceful degradation so the app boots if
  a reader fails.
- **Per-store domain selectors** (`useScopedTasks`, `useProjectBoard`) — intentionally bespoke;
  a generic selector helper would add complexity without removing any.
- **`api-client` error string format** and the **`withSession` wrapper** — already the right
  abstraction; don't churn them.
- **`Input` vs `TextField`** (both in `components/atoms/` after 1.0) — they serve different intents
  (full-width default-ring form field vs dense teal-ring inline edit); keep both as separate
  components. Optionally add a one-line doc comment clarifying when to use which; do **not** merge
  them. (Consolidating the *directory* — 1.0 — is not the same as merging these two components.)
- **z-index unification across dialogs** — the `z-50`/`z-[55]` differences are intentional stacking;
  `DialogOverlay` exposes `className` so both adopt the shared styles without changing their z-index.

## Definition of done (whole effort)

- [ ] Every selected finding (Workstreams A, B, C, D, plus E) is implemented or explicitly deferred
      with a recorded reason.
- [ ] No user-visible behavior change anywhere **except** the two Phase 4 API correctness fixes
      (409/400 mappings, UUID validation), each backed by new tests.
- [ ] Every new shared component/hook/helper has its own test; no existing test assertion was weakened
      to pass; no guardrail bypassed.
- [ ] Each phase has a demo doc under `docs/demos/frontend-dry-refactor/`; `npm run demo -- verify`
      passes; `check` (fast + slow) is green on each PR.
- [ ] Compounding-learning: the `data-flow` skill records the rollback-strategy guidance (C5); if any
      new repo-wide convention emerges (e.g. "reuse `DropdownMenuItem`, never hand-roll menu item
      classes"), capture it in the relevant skill.
