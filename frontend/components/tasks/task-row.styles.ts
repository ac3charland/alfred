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
 * The collapse wrapper's inner child — the single grid item inside the `display:grid`
 * collapse track (it also carries the mobile card chrome at depth 0). A grid item's automatic
 * minimum size is `min-content`, so without `min-w-0` the `nowrap` notes preview (see
 * `notesPreviewClass`) forces the grid column to grow to the note's full width, blowing the
 * card past the viewport and leaving nothing for `truncate` to clip — the mobile "description
 * doesn't truncate" bug (ALF-99). `min-w-0` lets the item shrink below that min-content so the
 * track stays at the card width and the notes ellipsize.
 */
export const collapseInnerClass = 'min-w-0';

/**
 * The one-line notes/description preview beneath the title: `truncate` clips it to a single line
 * with an ellipsis so a long note never spills the row. Relies on `collapseInnerClass` keeping
 * every ancestor width-bounded (a `truncate` element only ellipsizes when it has a width to
 * overflow).
 */
export const notesPreviewClass = 'truncate text-[12.5px] leading-snug text-[#6b7689]';

/**
 * Main row layout + colour transition. On mobile the row is a single, non-wrapping flex line:
 * chevron / checkbox / a title-and-meta column (see `rowContentColClass`) / actions. The title
 * and its metadata footer stack *inside that column*, so the leading controls (chevron /
 * checkbox) and trailing actions are `items-center` against the WHOLE card height — vertically
 * centred in the card, not pinned to the title's first line. At `md`+ the column dissolves
 * (`display:contents`) back into today's single inline line and the controls revert to
 * `items-start` (unchanged desktop layout).
 */
export const rowBaseClass = cn(
  'flex items-center gap-x-2 gap-y-1.5 rounded-sm py-2 pr-2',
  'md:items-start md:gap-y-2',
  'transition-colors duration-100 motion-reduce:transition-none',
);

/**
 * Mobile: the title (and, beneath it, the metadata footer) share one column so the leading
 * controls and trailing actions centre against the full card height rather than the title's
 * first line. It takes the row's remaining width (`flex-1`) and stacks its children. At `md`+
 * `display:contents` dissolves the column so the title and badges are direct row children
 * again — today's single inline line, in the same DOM (and tab) order.
 */
export const rowContentColClass = cn('min-w-0 flex-1 flex flex-col gap-y-1.5', 'md:contents');

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
 * The mobile metadata footer wrapper: the due / priority / count / type badges sit on their own
 * line *below the title, inside the shared content column* (see `rowContentColClass`), so a long
 * title never collides with the badges and both stack within the block the controls centre
 * against — no per-row indent needed, the column already starts under the title. At `md`+
 * `display: contents` dissolves the wrapper, so the badges are direct row children again —
 * today's inline right cluster, in the same DOM (and tab) order.
 */
export const metaFooterClass = cn('flex flex-wrap items-center gap-2', 'md:contents');

/**
 * Padding on the add-subtask reveal's inner (fading) layer. `py-1` gives the field's teal
 * `focus-visible` ring vertical room; `px-1` does the same horizontally, so the ring's left
 * edge isn't shaved off where the `flex-1` field sits flush against the reveal's
 * `overflow-hidden` height-animation clip. The ring reaches ~3px past the border box
 * (`ring-2` + `ring-offset-1`), which the 4px `px-1` clears (ALF-112).
 */
export const addSubtaskRevealClass = 'px-1 py-1';

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

/**
 * The add-subtask "+" button is desktop-only (ALF-118): on mobile the affordance collapses into
 * the row's ⋯ menu ("Add subtask" item), so the "+" is dropped from layout below `md` and only
 * the dot menu shows there; at `md`+ it reappears inline (`inline-flex`, hover-revealed) beside
 * the menu, exactly as today.
 */
export const addSubtaskButtonClass = 'hidden md:inline-flex';

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
