import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { cn } from '@/lib/utils';

/** Which folder tally a badge shows (ALF-84): amber "attention" or red "overdue". */
export type FolderCountTone = 'attention' | 'overdue';

interface FolderCountBadgeProperties {
  /** The count to show; the badge renders nothing at zero (or below). */
  count: number;
  /** Amber `attention` (high-priority / due today) or red `overdue` (past due). */
  tone: FolderCountTone;
}

/**
 * Per-tone presentation: the bordered pill colour and the meaning-naming `aria-label`. The tones
 * are feature-specific (attention ≠ the task-row "overdue" chip's amber), so they ride the atom's
 * tone-less `plain` variant with an explicit className — the same pattern the backlog badge uses —
 * rather than a shared semantic {@link Badge} variant.
 */
const TONE: Record<FolderCountTone, { className: string; label: (count: number) => string }> = {
  attention: {
    className: 'border border-accent-amber/50 text-accent-amber',
    label: (count) => `${String(count)} high-priority or due today`,
  },
  overdue: {
    className: 'border border-accent-red/50 text-accent-red',
    label: (count) => `${String(count)} overdue`,
  },
};

/**
 * A folder attention chip (ALF-84): how many active tasks in a folder need attention. Two of these
 * ride the folder link — an amber `attention` tally (high-priority or due today) and a red
 * `overdue` tally (past due) — so the sidebar splits "needs attention" from "already late" at a
 * glance. Renders nothing at zero, so folders with nothing due stay clean (no "0" chip). The
 * `aria-label` names the meaning, not just the number, so a folder link reads as "Work, 2
 * high-priority or due today, 1 overdue".
 */
export function FolderCountBadge({ count, tone }: FolderCountBadgeProperties) {
  if (count <= 0) return null;
  const { className, label } = TONE[tone];
  return (
    <Badge variant="plain" className={cn(className, 'font-medium')} aria-label={label(count)}>
      {count}
    </Badge>
  );
}
