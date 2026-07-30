'use client';

import { useDroppable } from '@dnd-kit/core';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { useBoardDrag } from '@/components/code/board/board-dnd-provider';
import { DraggableStoryCard } from '@/components/code/board/draggable-story-card';
import type { LaunchPhase } from '@/lib/code/launch';
import { laneDropId, resolveLaneDrop } from '@/lib/dnd/move-story-lane';
import type { BoardLane } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

import { laneBaseClass, laneDropActiveClass } from './swimlane.styles';

/**
 * The Done lane opens collapsed to its latest few completions and reveals more on demand (ALF-81):
 * it accumulates every finished story, so showing them all would bury the active lanes. Both are
 * lane-local, so a later state's swimlanes are unaffected.
 */
const DONE_INITIAL_VISIBLE = 3;
const DONE_REVEAL_STEP = 5;

export interface SwimlaneProperties {
  /** The lane to render: one happy-path state, its label, and the stories in it. */
  lane: BoardLane;
  /** The epic whose row this lane sits in — half of the lane's drop id (see `laneDropId`). */
  epicId: string;
  /** Forwarded to each card's `onOpen` (the detail-modal seam). */
  onOpenStory?: (story: CodeStory) => void;
  /** Forwarded to each card's `onOpenSession` (the human-launch action). */
  onOpenSession?: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * One vertical swimlane within an epic's board row: a fixed-width column headed by
 * the factory-state label + a live count, with the state's stories stacked as cards. The fixed
 * width keeps the row of six lanes horizontally scrollable in the dense layout.
 *
 * Each lane is also a **drop target**: dragging a card here moves that story to this state
 * (ALF-155), through the same optimistic write the detail modal's status menu makes. It lights
 * up only for a drag it would actually accept — a card from its own epic that isn't already in
 * this state — so the highlight never promises a move the drop refuses.
 *
 * An empty lane shows a faint placeholder so the column reads as "nothing here yet" rather
 * than looking broken.
 */
export function Swimlane({ lane, epicId, onOpenStory, onOpenSession }: SwimlaneProperties) {
  const dropId = laneDropId(epicId, lane.state);
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const { activeStory } = useBoardDrag();
  // The same resolver the drop runs, so highlight and outcome can never disagree.
  const accepts = activeStory !== null && resolveLaneDrop(activeStory, dropId) !== null;
  const isDropTarget = isOver && accepts;

  // The Done lane is capped to its latest few completions until "Show more" reveals another
  // batch; every other lane renders every card (the counter stays at its initial value, unread).
  const [visibleCount, setVisibleCount] = React.useState(DONE_INITIAL_VISIBLE);
  const collapsible = lane.state === 'done';
  const shownStories = collapsible ? lane.stories.slice(0, visibleCount) : lane.stories;
  const hiddenCount = lane.stories.length - shownStories.length;
  const revealNext = Math.min(DONE_REVEAL_STEP, hiddenCount);

  return (
    <section
      ref={setNodeRef}
      aria-label={lane.label}
      data-drop-over={isDropTarget ? 'true' : undefined}
      className={cn(laneBaseClass, isDropTarget && laneDropActiveClass)}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {lane.label}
        </h4>
        <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {lane.stories.length}
        </span>
      </header>
      <div className="flex flex-col gap-2 px-2 pb-2">
        {lane.stories.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground/50">No stories</p>
        ) : (
          shownStories.map((story) => {
            const openProperty = onOpenStory ? { onOpen: onOpenStory } : {};
            const sessionProperty = onOpenSession ? { onOpenSession } : {};
            return (
              <DraggableStoryCard
                key={story.item_id}
                story={story}
                {...openProperty}
                {...sessionProperty}
              />
            );
          })
        )}
        {hiddenCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-center text-xs font-medium text-muted-foreground"
            onClick={() => {
              setVisibleCount((current) => current + DONE_REVEAL_STEP);
            }}
          >
            Show {revealNext} more
          </Button>
        ) : null}
      </div>
    </section>
  );
}
