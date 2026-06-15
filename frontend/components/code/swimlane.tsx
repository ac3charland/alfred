'use client';

import * as React from 'react';

import { StoryCard } from '@/components/code/story-card';
import type { BoardLane } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

export interface SwimlaneProperties {
  /** The lane to render: one happy-path state, its label, and the stories in it. */
  lane: BoardLane;
  /** Forwarded to each card's `onOpen` (M6 detail modal seam). */
  onOpenStory?: (story: CodeStory) => void;
  /** Forwarded to each card's `onOpenSession` (the §11 human-launch action). */
  onOpenSession?: (
    story: CodeStory,
    phase: 'refinement' | 'implementation',
  ) => void | Promise<void>;
}

/**
 * One vertical swimlane within an epic's board row (§9.2): a fixed-width column headed by
 * the factory-state label + a live count, with the state's stories stacked as cards. Lanes
 * are **read-only** here — state changes come from links/webhook/the detail modal (drag is
 * a future enhancement, explicitly out of scope). The fixed width keeps the row of six
 * lanes horizontally scrollable in the dense layout.
 *
 * An empty lane shows a faint placeholder so the column reads as "nothing here yet" rather
 * than looking broken.
 */
export function Swimlane({ lane, onOpenStory, onOpenSession }: SwimlaneProperties) {
  return (
    <section
      aria-label={lane.label}
      className="flex w-60 shrink-0 flex-col rounded-lg bg-background/40"
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
          lane.stories.map((story) => {
            const openProperty = onOpenStory ? { onOpen: onOpenStory } : {};
            const sessionProperty = onOpenSession ? { onOpenSession } : {};
            return (
              <StoryCard key={story.item_id} story={story} {...openProperty} {...sessionProperty} />
            );
          })
        )}
      </div>
    </section>
  );
}
