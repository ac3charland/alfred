'use client';

import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { IconButton } from '@/components/atoms/icon-button';
import { StateChip } from '@/components/code/state-chip';
import { ViewLink } from '@/components/tasks/view-link';
import { type ProjectColor, projectBadgeClasses } from '@/lib/code/project-color';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import type { CodeStory } from '@/lib/types';

/** Rapid repeat clicks on a chevron collapse into one reorder/move call for the last click. */
const CHEVRON_DEBOUNCE_MS = 200;

export interface BacklogRowProperties {
  /** The ranked story to render. */
  story: CodeStory;
  /** The story's project colour (ALF-50), resolved by the Backlog from the project order. */
  projectColor: ProjectColor;
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
 *
 * Every chevron click is debounced (`useDebouncedCallback`) so a rapid burst — fast repeat taps,
 * or up/down mashed together — fires exactly one `onReorder`/`onMove` call for the last click,
 * instead of one overlapping request per click.
 */
export const BacklogRow = React.forwardRef<HTMLLIElement, BacklogRowProperties>(function BacklogRow(
  { story, projectColor, prevRef, nextRef, onReorder, onMove },
  ref,
) {
  const storyRef = story.ref;
  const href = `/code/${story.project_id ?? ''}?story=${storyRef ?? ''}`;

  // A burst of clicks on this row's chevrons (fast repeat taps, or up/down mashed together)
  // collapses into one call reflecting the last click, instead of one request per click.
  const debouncedReorder = useDebouncedCallback(onReorder, CHEVRON_DEBOUNCE_MS);
  const debouncedMove = useDebouncedCallback(onMove, CHEVRON_DEBOUNCE_MS);

  // The reorder chevrons enlarge to a real ≥44px tap target on mobile (their own box, not an
  // invisible overlay — stacked up/down would otherwise collide), back to today's 20px at md+.
  const reorderButtonClass = 'h-11 w-11 md:h-5 md:w-5';
  const reorderIconClass = 'h-5 w-5 md:h-3.5 md:w-3.5';

  return (
    <li
      ref={ref}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface transition-colors duration-100 hover:border-accent-teal/50 focus-within:ring-2 focus-within:ring-accent-blue focus-within:ring-offset-1 focus-within:ring-offset-background motion-reduce:transition-none"
    >
      <ViewLink
        href={href}
        aria-label={`Open ${storyRef ?? ''} ${story.title ?? ''}`}
        className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1 rounded-l-lg px-3 py-2 focus:outline-none md:items-center"
      >
        <span className="shrink-0 font-mono text-sm font-medium text-accent-teal md:text-xs">
          {storyRef}
        </span>
        {/* On mobile the title takes the head line's full remaining width and *wraps* at
          text-base (no longer truncated to "Disabl…"); at md+ it truncates on a single line
          exactly as today. */}
        <span className="min-w-0 flex-1 break-words text-base text-foreground md:truncate md:text-sm">
          {story.title}
        </span>
        {/* Project / epic / status badges: on mobile they wrap to a full-width footer line
          below the title; at md+ `display:contents` dissolves the wrapper so they sit inline
          to the title's right again — today's single crowded line. */}
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 md:contents">
          <Badge variant="plain" className={projectBadgeClasses(projectColor)}>
            {story.project_name ?? story.project_key}
          </Badge>
          <Badge variant="secondary">
            <span>{story.epic_name}</span>
            <span className="ml-1 font-mono text-muted-foreground/70">{story.epic_ref}</span>
          </Badge>
          <StateChip state={story.factory_state} />
        </div>
      </ViewLink>

      <div className="flex shrink-0 items-center gap-0.5 pr-1.5 md:pr-1.5">
        <div className="flex flex-col">
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} up`}
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null && storyRef !== null) debouncedReorder(storyRef, prevRef);
            }}
          >
            <ChevronUp size={14} className={reorderIconClass} />
          </IconButton>
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} down`}
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null && storyRef !== null) debouncedReorder(storyRef, nextRef);
            }}
          >
            <ChevronDown size={14} className={reorderIconClass} />
          </IconButton>
        </div>
        <div className="flex flex-col">
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to top`}
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null && storyRef !== null) debouncedMove(storyRef, true);
            }}
          >
            <ChevronsUp size={14} className={reorderIconClass} />
          </IconButton>
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to bottom`}
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null && storyRef !== null) debouncedMove(storyRef, false);
            }}
          >
            <ChevronsDown size={14} className={reorderIconClass} />
          </IconButton>
        </div>
      </div>
    </li>
  );
});
