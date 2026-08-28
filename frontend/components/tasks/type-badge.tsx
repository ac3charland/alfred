import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import type { ItemType } from '@/lib/types';

/** Human-readable label per type. Only types with a label render a badge. */
const TYPE_LABELS: Partial<Record<ItemType, string>> = {
  task: 'Task',
  code: 'Code',
  unclassified: 'Unclassified',
  // knowledge: reserved — leave room, don't render a badge yet.
};

interface TypeBadgeProperties {
  itemType: ItemType;
}

/**
 * A small muted chip naming an item's type — `Task`, `Code` or `Unclassified` — on the row's
 * metadata cluster. All three tones are identical: the badge is a label, not a verdict, so an
 * untriaged row reads as one value of a three-way field rather than an alert. Only the reserved
 * `knowledge` type renders nothing. Styling mirrors the row's count chips (the muted pill).
 *
 * The badge never decides WHERE it shows — that gate is the row's (`showTypeBadge` in TaskRow),
 * and it differs per type: `Code` everywhere, `Task` on an undispatched Inbox root, and
 * `Unclassified` in select mode only, where the bulk actions gate on type.
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
