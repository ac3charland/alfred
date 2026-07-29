import { cn } from '@/lib/utils';

/**
 * Visual styling for a sidebar folder row, extracted so the hover/breakpoint-only classes can
 * be locked by a unit test (jsdom renders no hover state, and the drag handle only exists at
 * `md`+).
 */

/** The folder row: the hover group the handle and actions reveal on, and the gaps' positioning
 *  context (each reorder strip is absolutely positioned against this row). */
export const folderRowClass = 'group/folder relative flex items-center gap-1 pr-1';

/** The row while it is the one being dragged — dimmed in place beneath its floating ghost,
 *  exactly as a dragged task row is. */
export const folderRowDraggingClass = 'opacity-40';

/**
 * Folder-actions cluster (the "More actions" kebab). Touch has no hover, so the kebab is ALWAYS
 * visible below `md` — that menu is the only way to reorder a folder there, since the drag
 * handle is desktop-only. At `md`+ it stays hidden until the row is hovered, then fades in. The
 * hide/reveal is gated on `motion-safe`, so a reduced-motion user keeps it visible at every
 * width. Mirrors the task row's actions cluster.
 */
export const folderActionsClass = cn(
  'shrink-0',
  'opacity-100 md:motion-safe:opacity-0 md:motion-safe:group-hover/folder:opacity-100',
  'transition-opacity duration-100 motion-reduce:transition-none',
);

/**
 * The drag handle: a grip that takes the folder icon's place on hover, so the row gains a drag
 * affordance without a permanent gutter (it's absolutely positioned over the icon, and outside
 * the link so a press on it starts a drag instead of following the href). Desktop only —
 * `hidden md:block` — because a touch user reorders through the row menu instead.
 */
export const folderDragHandleClass = cn(
  'absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 md:block',
  'cursor-grab text-muted-foreground active:cursor-grabbing',
  'opacity-0 group-hover/folder:opacity-100',
  'transition-opacity duration-100 motion-reduce:transition-none',
);

/** The folder icon, which fades out under the drag handle when the row is hovered at `md`+. */
export const folderIconClass = cn(
  'shrink-0',
  'md:group-hover/folder:opacity-0',
  'transition-opacity duration-100 motion-reduce:transition-none',
);
