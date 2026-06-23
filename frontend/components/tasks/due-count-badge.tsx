import * as React from 'react';

import { Badge } from '@/components/atoms/badge';

interface DueCountBadgeProperties {
  /** Number of active tasks in the folder due today or earlier. */
  count: number;
}

/**
 * The folder attention chip: how many active tasks in a folder are due today or overdue. Uses
 * the amber `overdue` {@link Badge} tone — mirroring a task row's overdue due chip — so the
 * sidebar surfaces "needs attention today" at a glance. Renders nothing at zero, so folders with
 * nothing due stay clean (no "0" chip), paralleling `TypeBadge`. The `aria-label` names the
 * meaning, not just the number, so a folder link reads as "Work, 3 due today or overdue".
 */
export function DueCountBadge({ count }: DueCountBadgeProperties) {
  if (count <= 0) return null;
  return (
    <Badge
      variant="overdue"
      className="font-medium"
      aria-label={`${String(count)} due today or overdue`}
    >
      {count}
    </Badge>
  );
}
