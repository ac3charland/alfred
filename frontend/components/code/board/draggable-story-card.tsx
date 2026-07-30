'use client';

import { useDraggable } from '@dnd-kit/core';
import * as React from 'react';

import { StoryCard, type StoryCardProperties } from '@/components/code/story-card';
import { isTempId } from '@/lib/tree';
import { cn } from '@/lib/utils';

/**
 * A story card that can be dragged to another swimlane (ALF-155). The drop itself is handled by
 * the `BoardDndProvider`'s onDragEnd (→ the optimistic `updateCodeState` action); this only
 * lifts the card and dims it in place while its ghost floats under the cursor.
 *
 * The WRAPPER is the draggable node rather than the card: dnd-kit sizes nothing off it here
 * (the overlay draws its own ghost), but keeping the hook outside `StoryCard` leaves that
 * component drag-free for the places it renders outside a lane — the abandoned bucket, the
 * store's own tests. The card body opts into being the drag surface (see the dnd-kit skill),
 * so a press-and-drag anywhere on it lifts while its launch chips keep their clicks.
 *
 * A story the server hasn't reconciled yet can't be dragged: it has no `ref` to PATCH (and a
 * temp item id would 404). Outside a DndContext (unit tests, stories) useDraggable is inert.
 */
export function DraggableStoryCard({ story, ...cardProperties }: StoryCardProperties) {
  const itemId = story.item_id;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: itemId ?? '',
    disabled: itemId === null || isTempId(itemId) || story.ref === null,
  });

  return (
    <div ref={setNodeRef} className={cn(isDragging && 'opacity-40')} {...listeners}>
      <StoryCard story={story} {...cardProperties} />
    </div>
  );
}
