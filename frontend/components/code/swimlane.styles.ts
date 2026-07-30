/**
 * Visual styling for a swimlane's drop-target state, extracted so the drag-state-only classes
 * can be locked by a unit test without standing up a live dnd-kit drag (useDroppable is inert
 * in jsdom, so `isOver` never flips there).
 */
export const laneBaseClass =
  'flex w-60 shrink-0 flex-col rounded-lg bg-background/40 transition-colors duration-100 motion-reduce:transition-none';

/** The lane under the pointer, when the drag in flight can actually land there. */
export const laneDropActiveClass = 'bg-accent-teal/15 ring-1 ring-inset ring-accent-teal/50';
