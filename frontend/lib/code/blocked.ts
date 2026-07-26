import type { CodeFactoryState, CodeStory } from '@/lib/types';

/** The two fields that decide where a `blocked` story's card sits: its state and its origin lane. */
export type BlockedOrigin = Pick<CodeStory, 'factory_state' | 'blocked_from'>;

/**
 * The `blocked_from` value a state transition should persist — the happy-path state a story is
 * leaving as it enters `blocked`, so the board can keep its card in that swimlane and Unblock
 * knows where to send it back (ALF-136).
 *
 * Blocking is the only transition that RECORDS an origin; every other one CLEARS it, so a story
 * that is not blocked never carries a stale lane. Two states have no lane to remember: `abandoned`
 * (its own bucket) and `null` (the view's all-nullable row type). Re-writing an already-blocked
 * story — a reason edit re-sends `factory_state: 'blocked'` — preserves the ORIGINAL origin rather
 * than overwriting it with `blocked` itself.
 *
 * Pure and dependency-free (a type-only import) so both sides of the write use the same rule: the
 * PATCH route derives the column from the stored row, and the store predicts it optimistically.
 */
export function nextBlockedFrom(
  current: BlockedOrigin,
  next: CodeFactoryState,
): CodeFactoryState | null {
  if (next !== 'blocked') return null;
  if (current.factory_state === 'blocked') return current.blocked_from;
  if (current.factory_state === null || current.factory_state === 'abandoned') return null;
  return current.factory_state;
}
