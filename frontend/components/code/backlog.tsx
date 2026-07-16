'use client';

import { GitBranch } from 'lucide-react';
import * as React from 'react';

import { BacklogList } from '@/components/code/backlog/backlog-list';
import { StatusFilterMenu } from '@/components/code/status-filter-menu';
import { useStatusFilter } from '@/lib/hooks/use-status-filter';
import { ALL_FACTORY_STATES, DEFAULT_BACKLOG_STATUSES, useBacklog } from '@/lib/stores/code-store';

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
 * - **List:** the shared `BacklogList` renders one `BacklogRow` per story, ranked by global
 *   `priority`, with the chevron reorder/move controls (see `BacklogList` / `BacklogRow`).
 *
 * Must be mounted under a `CodeProvider` (reads `useBacklog`; `BacklogList` reads the actions).
 */
export function Backlog() {
  // Defaults to the outstanding states (`done`/`abandoned` hidden until checked). Keyed
  // `'backlog'` so the selection persists across SPA navigation to a board and back.
  const { statuses, toggle, isFiltering } = useStatusFilter('backlog', DEFAULT_BACKLOG_STATUSES);
  const stories = useBacklog({ statuses });

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
        <StatusFilterMenu
          options={ALL_FACTORY_STATES}
          selected={statuses}
          onToggle={toggle}
          isFiltering={isFiltering}
        />
      </div>

      <BacklogList
        stories={stories}
        emptyMessage="No stories yet. Send a story to the Code module from your inbox to start ranking your backlog."
      />
    </div>
  );
}
