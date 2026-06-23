# ALF-32 — Add "bypass refinement" flow for small tasks

## Context / problem

The Software Factory board drives every story through a two-phase lifecycle:
**refine** (write a spec, open a refinement PR) → **implement** (build the merged
spec, open an implementation PR). The human launches each phase with the
phase-appropriate "Open Claude Code" button:

- `needs_refinement` → **"Refine in Claude Code"** (`buildRefinementUrl`, moves the
  story to `in_refinement`).
- `ready_for_dev` → **"Implement in Claude Code"** (`buildImplementationUrl`, moves
  the story to `in_development`).

For a small, well-understood task the refinement phase is pure overhead: there's
nothing to spec that a quick clarifying conversation in the implementation session
wouldn't settle just as well. Today the only way to skip it is to launch
refinement anyway (producing a throwaway spec PR) or to hand-drive the manual
state controls.

We want a **first-class "skip refinement" launch**: a second button next to
"Refine in Claude Code" that opens a single Claude Code session whose prompt is a
**blend** of the refinement and implementation prompts — *ask clarifying questions
if the requirements aren't clear, settle the plan, then jump straight into
implementation* — and opens **one** implementation PR. No spec file, no separate
refinement PR.

This is a frontend-only change: it reuses the existing launch contract, the
optimistic state-transition store action, and the PR → state machine in the
webhook Worker **as-is** (the bypass PR carries `phase: implementation`, which the
Worker already handles).

## Proposed change

Add a third **launch phase**, `bypass`, alongside the existing `refinement` and
`implementation` phases. It is offered **only** from `needs_refinement`, rendered
as a *secondary* action beside the primary "Refine in Claude Code" button, in both
the story card and the detail-modal header.

### 1. Launch metadata — `frontend/lib/code/launch.ts`

- Extend the `LaunchPhase` union with `'bypass'`.
- Add its labels to `LAUNCH_LABELS`:
  ```ts
  bypass: { idle: 'Skip to Development', busy: 'Opening development' }
  ```
- **Replace the single-phase `launchPhaseFor`** with a list-returning
  `launchPhasesFor(state): LaunchPhase[]` so a state can offer more than one launch:
  - `needs_refinement` → `['refinement', 'bypass']` (refinement first = primary).
  - `ready_for_dev` → `['implementation']`.
  - everything else (incl. `null`) → `[]`.

  Update the two existing call sites accordingly: the card's "can launch?" check
  becomes `launchPhasesFor(state).length > 0`, and the button now receives an
  explicit phase (see §3). Keeping the ordered list (primary first) is what lets
  the card/modal render the two `needs_refinement` actions in a stable order.
- Add a single source of truth for the post-launch target state, so the store
  doesn't branch on phase inline:
  ```ts
  /** The factory state a successful launch transitions the story into. */
  export const LAUNCH_TARGET_STATE: Record<LaunchPhase, CodeFactoryState> = {
    refinement: 'in_refinement',
    implementation: 'in_development',
    bypass: 'in_development', // skip in_refinement AND ready_for_dev — go straight to dev
  };
  ```

### 2. The blended prompt — `frontend/lib/code/links.ts`

Add `buildBypassUrl(project, story): string`, a pure builder like the two existing
ones (same `buildUrl` helper, same `notesContext` inlining + truncation, same
`ref: title` lead line so the new tab is scannable).

The prompt is a **blend** of `buildRefinementUrl` and `buildImplementationUrl`:

- Frames the session as *skip-refinement*: there is **no committed spec** to read,
  so — unlike `buildImplementationUrl` — it must **not** instruct the agent to read
  `spec_path`.
- Carries the refinement prompt's **clarification gate**: ground in the repo first
  (read any `CONTRIBUTING`/`CLAUDE.md`), and **if the ticket below doesn't pin down
  the scope, ASK HERE before building** rather than guessing — the human is in the
  tab.
- Then **once the plan is settled, implement directly** (the implementation
  prompt's intent): build the change, honoring the repo's own conventions/TDD.
- Opens **one** PR carrying the machine-readable block verbatim with
  **`phase: implementation`** (so the Worker advances the ticket through the normal
  implementation transitions). Use the existing `frontmatterBlock(story,
  'implementation', specPath)` helper; `specPath` falls back to the conventional
  `docs/specs/<REF>.md` exactly as `buildImplementationUrl` does (the `spec-path`
  line is harmless/ignored on an implementation PR — the comment in `links.ts`
  already documents this).
- Self-check tail mirroring the others: before opening the PR, confirm the change
  satisfies the agreed plan and the block is reproduced exactly.

**No spec file is produced** by this flow.

### 3. Rendering two launch buttons — `frontend/components/atoms/launch-button.tsx`

`LaunchButton` currently derives its single phase from the story internally. Change
it to take the **phase as an explicit prop** (`phase: LaunchPhase`) so a parent can
render more than one button for the same story. It keeps owning the launch contract
(the await-write-then-spinner in-flight state) and the `LAUNCH_LABELS` lookup;
only the phase source moves to the caller.

Add a **secondary** visual treatment for the bypass button so "Refine in Claude
Code" stays the obvious primary call to action:

- `chip` variant (card): the bypass chip is muted/neutral (e.g. a `border-border` /
  muted-foreground ghost chip) rather than the teal accent chip refinement uses.
- `solid` variant (modal): the bypass button uses a secondary/outline `Button`
  variant rather than the solid accent.

The exact classes are the implementer's call; the requirement is **clear visual
subordination** of "Skip to Development" to "Refine in Claude Code".

### 4. Call sites render the phase list

- **`story-card.tsx`** — replace the single `LaunchButton` with a row that maps over
  `launchPhasesFor(story.factory_state)`, rendering one `LaunchButton` per phase
  (variant `chip`). In `needs_refinement` this yields the teal "Refine in Claude
  Code" chip followed by the muted "Skip to Development" chip; in `ready_for_dev`,
  just "Implement in Claude Code".
- **`story-detail/primary-action.tsx`** (rendered in the modal header) — likewise
  map over `launchPhasesFor` and render a `LaunchButton variant="solid"` per phase,
  so the modal header shows "Refine in Claude Code" (solid accent) + "Skip to
  Development" (secondary) side by side.

### 5. Store + handler thread the new phase — `frontend/lib/stores/code-store.tsx`

- Widen `CodeActions.openClaudeSession`'s `phase` parameter from
  `'refinement' | 'implementation'` to the `LaunchPhase` type (import it from
  `lib/code/launch`).
- In `openClaudeSession`, select the URL builder by phase
  (`refinement → buildRefinementUrl`, `implementation → buildImplementationUrl`,
  `bypass → buildBypassUrl`) and the target state via `LAUNCH_TARGET_STATE[phase]`
  (replacing the current inline `phase === 'refinement' ? … : …`). The
  await-transition-then-`window.open` shape is unchanged.
- `board.tsx`'s `handleOpenSession` and the `OpenSessionHandler` type already pass
  `LaunchPhase` through; confirm they compile against the widened union (no logic
  change expected).

### What does NOT change

- **The webhook Worker / `transitions.ts`** — the bypass PR is `phase:
  implementation`, already handled: `opened → ready_for_review` (+ records
  `implementation_pr_url`), `closed & merged → done`, `closed & !merged →
  ready_for_dev`. No new phase value crosses the PR boundary.
- **The database enum** — `in_development` already exists; no migration.
- **Manual controls, realtime subscription, board grouping** — untouched.

## Acceptance criteria

- [ ] In `needs_refinement`, the story **card** shows two launch chips: "Refine in
      Claude Code" (primary, teal) and "Skip to Development" (secondary, muted), in
      that order.
- [ ] In `needs_refinement`, the **detail-modal** header shows both launch buttons,
      with "Skip to Development" visually subordinate to "Refine in Claude Code".
- [ ] In `ready_for_dev`, only "Implement in Claude Code" shows (no "Skip to
      Development"); in `in_refinement`, `in_development`, `ready_for_review`,
      `done`, `blocked`, and `abandoned`, no launch button shows at all.
- [ ] Clicking "Skip to Development" optimistically transitions the story to
      `in_development` (skipping `in_refinement` **and** `ready_for_dev`), then opens
      a new tab to a `claude.ai/code` URL — the await-write-then-open order matches
      the existing launch, and a failed write rolls the state back and re-enables the
      button.
- [ ] The bypass prompt: leads with `<ref>: <title>`; tells the agent to ground in
      the repo and **ask clarifying questions before building if scope is unclear**;
      instructs it to implement directly once the plan is settled; does **not**
      instruct it to read a committed spec; and ends by opening one PR whose body
      carries the verbatim `alfred` block with `phase: implementation`. Long notes
      are truncated with the same "ask me here for the rest" caveat as the other
      builders.
- [ ] No `docs/specs/<REF>.md` (or any spec file) is created by the bypass flow.
- [ ] **Tests** (red/green TDD, per CLAUDE.md — at least one test covers each new
      behavior):
  - `launch.test.ts`: `launchPhasesFor` returns `['refinement','bypass']` for
    `needs_refinement`, `['implementation']` for `ready_for_dev`, `[]` otherwise/
    `null`; `LAUNCH_LABELS.bypass` = `{ idle: 'Skip to Development', busy: 'Opening
    development' }`; `LAUNCH_TARGET_STATE` maps `bypass → 'in_development'`.
  - `links.test.ts`: `buildBypassUrl` produces a `claude.ai/code` URL with the right
    `repo`, a decoded prompt containing the clarify-then-implement instructions and
    the `phase: implementation` block, and **no** instruction to read a spec.
  - A component test (RTL / story play function) asserting both buttons render in
    `needs_refinement` and that clicking "Skip to Development" calls
    `onOpenSession(story, 'bypass')`.
  - Storybook story coverage for the card/modal showing the two-button
    `needs_refinement` state (the visual subordination is snapshot-covered).
- [ ] `check` (fast + slow) is green.
- [ ] A demo doc under `docs/demos/` captures the new flow (a `needs_refinement`
      card/modal screenshot showing both buttons, and the decoded bypass prompt), per
      the demo-doc workflow.

## Out of scope / open questions

- **Bypass PR closed unmerged → `ready_for_dev`.** The Worker's existing
  `implementation + closed & !merged → ready_for_dev` rule applies to a bypass story
  too, even though it never had a spec. It would then surface "Implement in Claude
  Code", whose prompt references a `spec_path` that doesn't exist (falling back to
  the conventional path). This is an accepted edge for now — out of scope to special-
  case; revisit if it bites.
- **No "skip" affordance from other states.** Skip is offered only from
  `needs_refinement`; states past refinement are out of scope.
- **No analytics/telemetry** on how often bypass is used (not part of this story).
- **Button label/visual polish** (exact chip styling, icon) is left to the
  implementer within the "clearly secondary" constraint above.
