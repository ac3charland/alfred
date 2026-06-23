import * as React from 'react';

import { Badge } from '@/components/atoms/badge';

interface DueCountBadgeProperties {
  count: number;
}

/**
 * Amber chip showing the count of active tasks due today or earlier in a folder.
 * Renders nothing when count is 0. Uses the shared `Badge` atom's outlined `warning`
 * tone, matching the overdue due-date chip.
 */
export function DueCountBadge({ count }: DueCountBadgeProperties) {
  if (count === 0) return null;
  return (
    <Badge
      variant="warning"
      className="font-medium"
      aria-label={`${String(count)} due today or overdue`}
    >
      {count}
    </Badge>
  );
}
