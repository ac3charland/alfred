import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import type { ItemType } from '@/lib/types';

/** Human-readable label per classified type. Only types with a label render a badge. */
const TYPE_LABELS: Partial<Record<ItemType, string>> = {
  task: 'Task',
  code: 'Code',
  // knowledge: reserved — leave room, don't render a badge yet.
};

interface TypeBadgeProperties {
  itemType: ItemType;
}

/**
 * A small muted chip naming an item's classified type — `Task` or `Code` — shown on
 * inbox/task rows once `item_type !== 'unclassified'`. An `unclassified` (or the
 * reserved `knowledge`) item renders nothing, so the row carries no type affordance until
 * it's classified. Styling mirrors the row's count chips (the muted bordered pill).
 */
export function TypeBadge({ itemType }: TypeBadgeProperties) {
  const label = TYPE_LABELS[itemType];
  if (label === undefined) return null;
  return (
    <Badge variant="muted" className="font-medium">
      {label}
    </Badge>
  );
}
