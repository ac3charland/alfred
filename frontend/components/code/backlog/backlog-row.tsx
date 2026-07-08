'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { IconButton } from '@/components/atoms/icon-button';
import { StateChip } from '@/components/code/state-chip';
import { ViewLink } from '@/components/tasks/view-link';
import { type ProjectColor, projectBadgeClasses } from '@/lib/code/project-color';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import type { ReorderStep } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/** A chevron burst reorders on screen instantly; only the network sync waits this long. */
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
  /** True when this story already ranks best within its own project — disables "to top of project". */
  isProjectTop: boolean;
  /** True when this story already ranks worst within its own project — disables "to bottom of project". */
  isProjectBottom: boolean;
  /** Apply one chevron swap's optimistic half instantly (the store's `applyReorderOptimistic`). */
  applyReorder: (ref: string, neighbourRef: string) => ReorderStep | null;
  /** Sync a burst of applied swaps to the server, in order (the store's `commitReorderBatch`). */
  commitReorder: (steps: ReorderStep[]) => Promise<void>;
  /**
   * Apply one project-scoped jump's optimistic half instantly (ALF-110, the store's
   * `applyMoveInProjectOptimistic`).
   */
  applyMoveInProject: (ref: string, toTop: boolean) => { priorityBefore: number | null } | null;
  /** Sync the latest project-scoped jump to the server (the store's `commitMoveInProject`). */
  commitMoveInProject: (
    ref: string,
    toTop: boolean,
    priorityBefore: number | null,
  ) => Promise<void>;
  /**
   * Apply one whole-Backlog jump's optimistic half instantly (the store's
   * `applyMoveOptimistic`).
   */
  applyMove: (ref: string, toTop: boolean) => { priorityBefore: number | null } | null;
  /** Sync the latest whole-Backlog jump to the server (the store's `commitMove`). */
  commitMove: (ref: string, toTop: boolean, priorityBefore: number | null) => Promise<void>;
}

/**
 * The instant-apply + debounced-commit pattern shared by the project-scope and whole-Backlog
 * jump buttons: every click re-ranks the story on screen immediately, but only ONE network call
 * — the LATEST click's direction, rolling back to the burst's ORIGINAL prior priority on failure
 * — goes out once the clicks settle. A jump is idempotent in its direction, so (unlike the
 * neighbour-swap reorder) it never needs to replay earlier clicks in the burst.
 */
function useMoveBurst(
  storyRef: string | null,
  apply: (ref: string, toTop: boolean) => { priorityBefore: number | null } | null,
  commit: (ref: string, toTop: boolean, priorityBefore: number | null) => Promise<void>,
): (toTop: boolean) => void {
  const burstRef = React.useRef<{ toTop: boolean; priorityBefore: number | null } | null>(null);

  const flush = useDebouncedCallback(() => {
    const burst = burstRef.current;
    burstRef.current = null;
    if (burst !== null && storyRef !== null)
      void commit(storyRef, burst.toTop, burst.priorityBefore);
  }, CHEVRON_DEBOUNCE_MS);

  return (toTop: boolean) => {
    if (storyRef === null) return;
    const applied = apply(storyRef, toTop);
    if (applied !== null) {
      // Keep the FIRST click's prior priority for the whole burst — later clicks never reach
      // the server, so that original is what a failed commit rolls back to.
      burstRef.current = {
        toTop,
        priorityBefore: burstRef.current?.priorityBefore ?? applied.priorityBefore,
      };
    }
    flush();
  };
}

/**
 * One Backlog row, single column: a link body to the story's detail modal in its project board
 * (`/code/<projectId>?story=<ref>` — see board.tsx's deep-link seam) showing the ref, title,
 * a project badge, an epic badge, and a **status badge for every factory state** (the shared
 * `StateChip`, not `story-card`'s blocked/abandoned-only chip); plus three button PAIRS (ALF-110),
 * each with hover text explaining what it does — single chevrons to swap with the visible
 * neighbour, double chevrons to jump to the top/bottom of the story's own PROJECT, and
 * arrow-to-line icons to jump to the top/bottom of the WHOLE Backlog — kept OUTSIDE the link so
 * there are no nested interactive elements (mirroring how `story-card` separates its clickable
 * body from its launch buttons).
 *
 * Forwards a ref to the root `<li>` so the Backlog's `useFlipList` can animate the reorder.
 *
 * Every button reorders the list INSTANTLY — the row steps through each swap/jump live, even
 * across a rapid burst. Only the NETWORK sync is debounced (`useDebouncedCallback`): a burst of
 * clicks queues (reorder) or coalesces (the two jump kinds) locally, and flushes to the server
 * once the clicks settle, instead of one overlapping request per click.
 */
export const BacklogRow = React.forwardRef<HTMLLIElement, BacklogRowProperties>(function BacklogRow(
  {
    story,
    projectColor,
    prevRef,
    nextRef,
    isProjectTop,
    isProjectBottom,
    applyReorder,
    commitReorder,
    applyMoveInProject,
    commitMoveInProject,
    applyMove,
    commitMove,
  },
  ref,
) {
  const storyRef = story.ref;
  const href = `/code/${story.project_id ?? ''}?story=${storyRef ?? ''}`;

  // The reorder steps queued (in click order) for the burst currently in flight — flushed to the
  // server once the debounce settles, then cleared.
  const reorderStepsRef = React.useRef<ReorderStep[]>([]);

  const flushReorder = useDebouncedCallback(() => {
    const steps = reorderStepsRef.current;
    reorderStepsRef.current = [];
    if (steps.length > 0) void commitReorder(steps);
  }, CHEVRON_DEBOUNCE_MS);

  const reorder = (neighbourRef: string) => {
    if (storyRef === null) return;
    const step = applyReorder(storyRef, neighbourRef);
    if (step !== null) reorderStepsRef.current.push(step);
    flushReorder();
  };

  const moveInProject = useMoveBurst(storyRef, applyMoveInProject, commitMoveInProject);
  const move = useMoveBurst(storyRef, applyMove, commitMove);

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
            title="Swap with the story above"
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null) reorder(prevRef);
            }}
          >
            <ChevronUp size={14} className={reorderIconClass} />
          </IconButton>
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} down`}
            title="Swap with the story below"
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null) reorder(nextRef);
            }}
          >
            <ChevronDown size={14} className={reorderIconClass} />
          </IconButton>
        </div>
        <div className="flex flex-col">
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to top of project`}
            title="Move to the top of this story's project"
            disabled={isProjectTop}
            onClick={() => {
              moveInProject(true);
            }}
          >
            <ChevronsUp size={14} className={reorderIconClass} />
          </IconButton>
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to bottom of project`}
            title="Move to the bottom of this story's project"
            disabled={isProjectBottom}
            onClick={() => {
              moveInProject(false);
            }}
          >
            <ChevronsDown size={14} className={reorderIconClass} />
          </IconButton>
        </div>
        <div className="flex flex-col">
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to top of list`}
            title="Move to the top of the whole Backlog"
            disabled={prevRef === null}
            onClick={() => {
              if (prevRef !== null) move(true);
            }}
          >
            <ArrowUpToLine size={14} className={reorderIconClass} />
          </IconButton>
          <IconButton
            size="sm"
            className={reorderButtonClass}
            aria-label={`Move ${storyRef ?? ''} to bottom of list`}
            title="Move to the bottom of the whole Backlog"
            disabled={nextRef === null}
            onClick={() => {
              if (nextRef !== null) move(false);
            }}
          >
            <ArrowDownToLine size={14} className={reorderIconClass} />
          </IconButton>
        </div>
      </div>
    </li>
  );
});
