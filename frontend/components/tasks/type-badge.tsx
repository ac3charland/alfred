import * as React from 'react';

import type { ItemType } from '@/lib/types';

/** Human-readable label per classified type. Only types with a label render a badge. */
const TYPE_LABELS: Partial<Record<ItemType, string>> = {
  task: 'Task',
  code: 'Code',
  // knowledge: reserved (§7.2) — leave room, don't render a badge yet.
};

interface TypeBadgeProperties {
  itemType: ItemType;
}

/**
 * A small muted chip naming an item's classified type — `Task` or `Code` — shown on
 * inbox/task rows once `item_type !== 'unclassified'` (§7.2). An `unclassified` (or the
 * reserved `knowledge`) item renders nothing, so the row carries no type affordance until
 * it's classified. Styling mirrors the row's count chips (the muted bordered pill).
 */
export function TypeBadge({ itemType }: TypeBadgeProperties) {
  const label = TYPE_LABELS[itemType];
  if (label === undefined) return null;
  return (
    <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}
