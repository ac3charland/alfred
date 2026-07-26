import { STATE_LABELS } from '@/lib/stores/code-store';
import type { CodeFactoryState } from '@/lib/types';

/** Human label for any factory state, including the escape states (which have no lane). */
export function stateLabel(state: CodeFactoryState | null): string {
  if (state === 'blocked') return 'Blocked';
  if (state === 'abandoned') return 'Abandoned';
  if (state === null) return 'Unknown';
  return STATE_LABELS[state];
}
