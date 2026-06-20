/**
 * Visual styling for the sidebar drop zone, extracted so the drag-state-only classes can be
 * locked by a unit test without standing up a live dnd-kit drag (useDroppable is inert in
 * jsdom, so `isOver` never flips there).
 */
export const dropZoneBaseClass =
  'rounded-sm transition-colors duration-100 motion-reduce:transition-none';
export const dropZoneActiveClass = 'bg-accent-teal/15 ring-1 ring-accent-teal/50';
