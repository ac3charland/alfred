'use client';

import { GitBranch, ListFilter } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { BacklogRow } from '@/components/code/backlog/backlog-row';
import { projectColorFor } from '@/lib/code/project-color';
import { useFlipList } from '@/lib/hooks/use-flip-list';
import {
  ALL_FACTORY_STATES,
  DEFAULT_BACKLOG_STATUSES,
  FACTORY_STATE_LABELS,
  useBacklog,
  useCodeActions,
  useProjects,
} from '@/lib/stores/code-store';
import type { CodeFactoryState } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The Backlog — the default Code view (bare `/code` and `/code/backlog`). A single global,
 * priority-ordered list of every OUTSTANDING story across all projects and epics, that the owner
 * re-ranks with chevron swaps; the project boards fall in line beneath this one ranking.
 *
 * - **Header (the repurposed hero):** the old `CodeLanding` treatment — the `GitBranch` badge and
 *   the `font-serif` "The Software Factory" title — re-copied to describe the Backlog, with a
 *   **Filter by status** dropdown (multi-select checkboxes, one per factory state) that controls
 *   which statuses are listed. It defaults to the outstanding states, so `done`/`abandoned` are
 *   hidden until the owner checks them.
 * - **List:** one `BacklogRow` per story, ranked by global `priority`. The single chevrons swap a
 *   story with its visible neighbour (`reorderStory`); the double chevrons jump it to the top or
 *   bottom of the Backlog (`moveStory`). Both are animated via `useFlipList` (FLIP), honouring
 *   `prefers-reduced-motion`.
 *
 * Must be mounted under a `CodeProvider` (reads `useBacklog` / `useCodeActions`).
 */
export function Backlog() {
  const [statuses, setStatuses] =
    React.useState<readonly CodeFactoryState[]>(DEFAULT_BACKLOG_STATUSES);
  const stories = useBacklog({ statuses });
  const projects = useProjects();
  const { reorderStory, moveStory } = useCodeActions();
  // Animate the reorder: FLIP keyed by item_id over the currently rendered order.
  const registerRow = useFlipList(stories.map((story) => story.item_id ?? ''));

  const toggleStatus = React.useCallback((state: CodeFactoryState) => {
    setStatuses((current) =>
      current.includes(state)
        ? current.filter((candidate) => candidate !== state)
        : [...current, state],
    );
  }, []);

  // Any non-default selection narrows the list — flag it on the trigger so the owner sees the
  // Backlog isn't showing everything (the default itself hides `done`/`abandoned`).
  const isFiltering = statuses.length !== ALL_FACTORY_STATES.length;

  const handleReorder = React.useCallback(
    (ref: string, neighbourRef: string) => {
      void (async () => {
        try {
          await reorderStory(ref, neighbourRef);
        } catch {
          // The store rolled the swap back; nothing extra to undo here.
        }
      })();
    },
    [reorderStory],
  );

  const handleMove = React.useCallback(
    (ref: string, toTop: boolean) => {
      void (async () => {
        try {
          await moveStory(ref, toTop);
        } catch {
          // The store rolled the move back; nothing extra to undo here.
        }
      })();
    },
    [moveStory],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
            <GitBranch size={20} />
          </div>
          <div className="flex flex-col">
            <h2 className="font-serif text-2xl text-foreground">The Software Factory</h2>
            <p className="text-sm text-muted-foreground">
              Every story across your projects, ranked by priority.
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'gap-1.5',
                isFiltering &&
                  'border-accent-teal/60 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/10 hover:text-accent-teal',
              )}
            >
              <ListFilter size={14} />
              Filter by status
              {isFiltering ? ` (${String(statuses.length)})` : ''}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ALL_FACTORY_STATES.map((state) => (
              <DropdownMenuCheckboxItem
                key={state}
                checked={statuses.includes(state)}
                onCheckedChange={() => {
                  toggleStatus(state);
                }}
                // Keep the menu open so several statuses can be toggled in one pass.
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                {FACTORY_STATE_LABELS[state]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {stories.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {stories.map((story, index) => (
            <BacklogRow
              key={story.item_id}
              ref={registerRow(story.item_id ?? '')}
              story={story}
              projectColor={projectColorFor(projects, story.project_id)}
              prevRef={index === 0 ? null : (stories[index - 1]?.ref ?? null)}
              nextRef={index === stories.length - 1 ? null : (stories[index + 1]?.ref ?? null)}
              onReorder={handleReorder}
              onMove={handleMove}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No stories yet. Send a story to the Code module from your inbox to start ranking your
            backlog.
          </p>
        </div>
      )}
    </div>
  );
}
