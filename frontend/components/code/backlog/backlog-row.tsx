'use client';

import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { IconButton } from '@/components/atoms/icon-button';
import { StateChip } from '@/components/code/state-chip';
import { ViewLink } from '@/components/tasks/view-link';
import type { CodeStory } from '@/lib/types';

export interface BacklogRowProperties {
  /** The ranked story to render. */
  story: CodeStory;
  /** The visible neighbour above (the Up swap target), or null at the top — Up is disabled. */
  prevRef: string | null;
  /** The visible neighbour below (the Down swap target), or null at the bottom — Down disabled. */
  nextRef: string | null;
  /** Swap this story's priority with the given neighbour ref (the store's `reorderStory`). */
  onReorder: (ref: string, neighbourRef: string) => void;
  /** Jump this story to the top (`toTop`) or bottom of the Backlog (the store's `moveStory`). */
  onMove: (ref: string, toTop: boolean) => void;
}

/**
 * One Backlog row, single column: a link body to the story's detail modal in its project board
 * (`/code/<projectId>?story=<ref>` — see board.tsx's deep-link seam) showing the ref, title,
 * a project badge, an epic badge, and a **status badge for every factory state** (the shared
 * `StateChip`, not `story-card`'s blocked/abandoned-only chip); plus a chevron cluster — single
 * chevrons for the neighbour-swap reorder and double chevrons to jump straight to the top/bottom
 * of the Backlog — kept OUTSIDE the link so there are no nested interactive elements (mirroring
 * how `story-card` separates its clickable body from its launch buttons).
 *
 * Forwards a ref to the root `<li>` so the Backlog's `useFlipList` can animate the reorder.
 */
export const BacklogRow = React.forwardRef<HTMLLIElement, BacklogRowProperties>(function BacklogRow(
  { story, prevRef, nextRef, onReorder, onMove },
  ref,
) {
  const storyRef = story.ref;
  const href = `/code/${story.project_id ?? ''}?story=${storyRef ?? ''}`;

  return (
    <li
      ref={ref}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface transition-colors duration-100 hover:border-accent-teal/50 focus-within:ring-2 focus-within:ring-accent-blue focus-within:ring-offset-1 focus-within:ring-offset-background motion-reduce:transition-none"
    >
      <ViewLink
        href={href}
        aria-label={`Open ${storyRef ?? ''} ${story.title ?? ''}`}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-l-lg px-3 py-2 focus:outline-none"
      >
        <span className="font-mono text-xs font-medium text-accent-teal">{storyRef}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{story.title}</span>
        <Badge variant="accent">{story.project_name ?? story.project_key}</Badge>
        <Badge variant="secondary">
          <span>{story.epic_name}</span>
          <span className="ml-1 font-mono text-muted-foreground/70">{story.epic_ref}</span>
        </Badge>
        <StateChip state={story.factory_state} />
      </ViewLink>

      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        <div className="flex flex-col">
          <IconButton
            size="sm"
            aria-label={`Move ${storyRef ?? ''} up`}
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null && storyRef !== null) onReorder(storyRef, prevRef);
            }}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label={`Move ${storyRef ?? ''} down`}
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null && storyRef !== null) onReorder(storyRef, nextRef);
            }}
          >
            <ChevronDown size={14} />
          </IconButton>
        </div>
        <div className="flex flex-col">
          <IconButton
            size="sm"
            aria-label={`Move ${storyRef ?? ''} to top`}
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null && storyRef !== null) onMove(storyRef, true);
            }}
          >
            <ChevronsUp size={14} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label={`Move ${storyRef ?? ''} to bottom`}
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null && storyRef !== null) onMove(storyRef, false);
            }}
          >
            <ChevronsDown size={14} />
          </IconButton>
        </div>
      </div>
    </li>
  );
});
