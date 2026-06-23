import * as React from 'react';

interface DueCountBadgeProperties {
  count: number;
}

/**
 * Amber chip showing the count of active tasks due today or earlier in a folder.
 * Renders nothing when count is 0. Mirrors the due chip geometry in task-row.tsx.
 */
export function DueCountBadge({ count }: DueCountBadgeProperties) {
  if (count === 0) return null;
  return (
    <span
      aria-label={`${String(count)} due today or overdue`}
      className="shrink-0 rounded-full border border-accent-amber/50 px-2 py-0.5 text-xs font-medium text-accent-amber"
    >
      {count}
    </span>
  );
}
