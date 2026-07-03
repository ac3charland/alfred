import { cn } from '@/lib/utils';

/**
 * Visual styling for the task row, extracted so its many state-conditional cosmetic classes
 * (drop-target, completing, edit-mode) are locked by a unit test without having to reproduce
 * each live drag/edit/complete state in jsdom. The row's *behaviour* is covered by
 * task-row.test; this is its chrome. Classes already asserted there (e.g. the complete-state
 * `bg-accent-teal`, the chevron `rotate-90`, the `invisible` toggle) stay inline in the row.
 */

/** Outer wrapper: the completion-collapse grid-rows transition. */
export const collapseClass =
  'grid transition-[grid-template-rows] duration-300 ease-out delay-200 motion-reduce:transition-none';

/**
 * Outer wrapper for the *deletion* collapse — the same grid-rows shrink as completion, but with
 * NO `delay-200`: there's no checkbox pop to hold the collapse behind, so the height pulls the
 * neighbouring rows up the instant delete is chosen, in step with the row fading out.
 */
export const deleteCollapseClass =
  'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none';

/** The deletion fade: the whole row content fades to transparent as the height collapses. */
export const deleteFadeClass =
  'transition-opacity duration-200 ease-out motion-reduce:transition-none';

/**
 * Main row layout + colour transition. On mobile the row is a *wrapping* flex: the head
 * (chevron / checkbox / title / actions) sits on the first line and the metadata badges wrap
 * to their own full-width footer line below (see `metaFooterClass`). At `md`+ it collapses back
 * to today's single, non-wrapping line — the same responsive convention as `rowActionsClass`.
 *
 * The head-line controls (checkbox / chevron / actions) are `items-center` on mobile so they
 * sit centred against the title block instead of pinned to its first line — a two-line wrapped
 * title reads better with the checkbox centred beside it. At `md`+ it reverts to `items-start`
 * (single-line rows, unchanged desktop layout).
 */
export const rowBaseClass = cn(
  'flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-sm py-2 pr-2',
  'md:flex-nowrap md:items-start md:gap-y-2',
  'transition-colors duration-100 motion-reduce:transition-none',
);

/**
 * Depth-0 card chrome (mobile): each top-level item + its whole subtree becomes one rounded
 * `surface` panel with a border and generous padding — the card boundary is drawn exactly once,
 * at the top-level node, enclosing every descendant. At `md`+ the chrome dissolves so the rows
 * fall back into the shared `divide-y` list (see `taskListContainerClass`).
 */
export const cardChromeClass = cn(
  'rounded-2xl border border-border bg-surface p-1',
  'md:rounded-none md:border-0 md:bg-transparent md:p-0',
);

/**
 * The mobile metadata footer wrapper: the due / priority / count / type badges wrap to a
 * full-width line *below* the title, so a long title takes the row's full width instead of
 * colliding with the badges. Its left indent — which keeps the footer under the title — is set
 * inline per row (it tracks the chevron/checkbox columns the row actually shows on mobile; both
 * are dropped when absent). At `md`+ `display: contents` dissolves the wrapper, so the badges are
 * direct row children again — today's inline right cluster, in the same DOM (and tab) order, and
 * the inline indent is ignored.
 */
export const metaFooterClass = cn(
  'flex basis-full flex-wrap items-center gap-2 order-last',
  'md:contents',
);

/**
 * Inside a mobile card the subtask subtree is set off from the parent by a hairline and its
 * rows are hairline-separated (indented, never their own cards). At `md`+ every rule zeroes out,
 * restoring today's flush, undivided nested list.
 */
export const subtreeClass = cn(
  'mt-2 border-t border-border/50 pt-1 divide-y divide-border/50',
  'md:mt-0 md:border-t-0 md:pt-0 md:divide-y-0',
);

/**
 * Expands a control's touch target to ≥44px on mobile via an invisible overlay that doesn't
 * change layout (the drawn box stays its small visual size); removed at `md`+ where pointer
 * devices don't need it. Applied to the enlarged checkbox and expand chevron, which sit apart
 * enough that their overlays don't collide (unlike the backlog's stacked reorder chevrons, which
 * enlarge their real box instead).
 */
export const mobileTapClass =
  "relative after:absolute after:-inset-3 after:content-[''] md:after:hidden";
/** Valid drop-target highlight (teal wash + ring). */
export const rowDropTargetClass = 'bg-accent-teal/15 ring-1 ring-accent-teal/50';
/** Default hover wash when the row is not a drop target. */
export const rowHoverClass = 'hover:bg-secondary/30';

/** Expand/collapse chevron button — keeps it from shrinking in the row flex. */
export const chevronButtonClass = 'shrink-0';
/** Chevron icon rotation transition. */
export const chevronIconClass = 'transition-transform duration-150 motion-reduce:transition-none';

/**
 * Row-actions cluster (Add subtask + More actions). Touch/mobile has no hover, so the actions
 * are ALWAYS visible below `md` (ALF-88) — matching the app's `md`-breakpoint = mobile
 * convention (sidebar `hidden md:flex`, mobile header `md:hidden`). On `md`+ pointer devices
 * they stay hidden until the row is hovered, then fade in. The hide/reveal are gated on
 * `motion-safe`, so a reduced-motion user keeps the actions visible at every width (the fade
 * is also cut via `motion-reduce:transition-none`).
 */
export const rowActionsClass = cn(
  'shrink-0 flex items-center gap-1',
  // On mobile the actions ride the head line (order-3, after the title); the badges footer
  // (order-last) wraps below them. At md+ the ordering resets so the badges sit inline before
  // the actions again — today's layout.
  'order-3 md:order-none',
  'opacity-100 md:motion-safe:opacity-0 md:motion-safe:group-hover/row:opacity-100',
  'transition-opacity duration-100 motion-reduce:transition-none',
);

/** The "+" shown in place of the checkbox while a task is dropped onto this row (matches the
 * enlarged mobile checkbox box, back to 16px at md+). */
export const dropPlusClass =
  'flex h-6 w-6 md:h-4 md:w-4 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal text-background';

/**
 * Completion checkbox sizing + the incomplete (un-checked) border/hover treatment. Enlarged to a
 * ≥24px visual box on mobile (the ≥44px hit area comes from `mobileTapClass`), back to today's
 * 16px at `md`+.
 */
export const checkboxSizeClass = 'h-6 w-6 md:h-4 md:w-4';
// The un-checked border reads at a mid-grey (`muted-foreground/50`) rather than the near-invisible
// `border` token, so the empty box has enough contrast to be spotted at a glance in every view.
export const checkboxIncompleteClass =
  'border-muted-foreground/50 hover:border-accent-teal transition-colors duration-100 motion-reduce:transition-none';

/** Inline title-edit input + its confirm checkbox. */
export const titleInputClass = 'flex-1 min-w-0 py-0.5';
export const confirmTitleClass = 'h-5 w-5 border-accent-teal bg-accent-teal';

/**
 * The title text: a compact 15px with `leading-snug` on mobile so it reads comfortably on a
 * phone without a long wrapped title spreading over too many airy lines, back to today's
 * `text-sm` / 1.25rem leading at `md`+ (`md:leading-5` restores text-sm's native line-height so
 * desktop is unchanged). Wraps (break-words for unbroken strings) and fades to low-contrast as
 * the row completes.
 */
export const titleTextClass =
  'text-[15px] leading-snug md:text-sm md:leading-5 break-words transition-colors duration-300 delay-200 motion-reduce:transition-none';

/**
 * The direct-subtask count pill (e.g. `2/5`) — moved out of the row's inline JSX into a named
 * class alongside the other chrome so it's locked by the styles test, not sprinkled inline.
 */
export const subtaskCountBadgeClass = 'bg-[#1b2438] px-3 py-[3px] text-[13px] text-[#8b97a9]';

/**
 * The tasks list container. On mobile it's a gapped column so each top-level item is a
 * free-standing card (the card chrome lives on the depth-0 row); at `md`+ it restores today's
 * one rounded, hairline-divided `surface` panel.
 */
export const taskListContainerClass = cn(
  'flex flex-col gap-2',
  'md:block md:gap-0 md:rounded-2xl md:border md:border-border md:bg-surface md:divide-y md:divide-border/50 md:overflow-hidden',
);
