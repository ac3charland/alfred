import { HAPPY_PATH_STATES, STATE_LABELS } from '@/lib/stores/code-store';
import type { CodeFactoryState } from '@/lib/types';

/** Human label for any factory state, including the escape states (which have no lane). */
export function stateLabel(state: CodeFactoryState | null): string {
  if (state === 'blocked') return 'Blocked';
  if (state === 'abandoned') return 'Abandoned';
  if (state === null) return 'Unknown';
  return STATE_LABELS[state];
}

/** The happy-path neighbour one step forward / back, clamped at the ends (manual hop). */
export function neighbourState(
  state: CodeFactoryState | null,
  direction: 'advance' | 'revert',
): CodeFactoryState | undefined {
  if (state === null) return undefined;
  const index = HAPPY_PATH_STATES.indexOf(state as (typeof HAPPY_PATH_STATES)[number]);
  // Off the happy path (blocked/abandoned, index -1) → no advance/revert neighbour.
  if (index === -1) return undefined;
  const nextIndex = direction === 'advance' ? index + 1 : index - 1;
  return HAPPY_PATH_STATES[nextIndex];
}
