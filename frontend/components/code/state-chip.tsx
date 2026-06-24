import { Badge } from '@/components/atoms/badge';
import { stateLabel } from '@/components/code/story-detail/state-helpers';
import type { CodeFactoryState } from '@/lib/types';

/**
 * The factory-state chip, tinted per happy-path / blocked / abandoned and labelled for EVERY
 * state (via `stateLabel`). Shared by the story detail-modal header and the Backlog row, which
 * both show the status on every story — unlike `story-card`'s inline chip, which renders only
 * for the blocked/abandoned escape states.
 */
export function StateChip({ state }: { state: CodeFactoryState | null }) {
  const variant = state === 'blocked' ? 'alert' : state === 'abandoned' ? 'destructive' : 'accent';
  return (
    <Badge
      variant={variant}
      data-factory-state={state ?? undefined}
      className="font-semibold uppercase tracking-wide"
    >
      {stateLabel(state)}
    </Badge>
  );
}
