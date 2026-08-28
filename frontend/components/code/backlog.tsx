'use client';

import { GitBranch } from 'lucide-react';
import * as React from 'react';

import { BacklogList } from '@/components/code/backlog/backlog-list';
import { PrRatio } from '@/components/code/pr-ratio';
import { ProjectFilterMenu } from '@/components/code/project-filter-menu';
import { StatusFilterMenu } from '@/components/code/status-filter-menu';
import { useProjectFilter } from '@/lib/hooks/use-project-filter';
import { useStatusFilter } from '@/lib/hooks/use-status-filter';
import {
  ALL_FACTORY_STATES,
  DEFAULT_BACKLOG_STATUSES,
  useBacklog,
  useProjects,
} from '@/lib/stores/code-store';

/**
 * The Backlog (`/code/backlog`). A single global, priority-ordered list of every OUTSTANDING
 * story across all projects and epics, that the owner re-ranks with chevron swaps; the project
 * boards fall in line beneath this one ranking. It was the module's default view until ALF-174
 * handed that role to the "Needs human action" queue, so the bare `/code` no longer lands here.
 *
 * - **Header (the repurposed hero):** the old `CodeLanding` treatment — the `GitBranch` badge and
 *   the `font-serif` "The Software Factory" title — re-copied to describe the Backlog, with two
 *   multi-select dropdowns narrowing what's listed: **Filter by status** (one checkbox per factory
 *   state, defaulting to the outstanding ones so `done`/`abandoned` are hidden until checked) and
 *   **Filter by project** (ALF-156 — one checkbox per project, all checked, so the list stays
 *   cross-project until the owner narrows it). The project control is absent on a deployment with
 *   no projects yet, where it would offer an empty menu.
 * - **Ratio card:** `PrRatio` — this week's merged-PR split across the configured repos. An
 *   ornament, never a gate: it renders nothing at all on a deployment that hasn't configured
 *   it, so the rest of the view is unaffected.
 * - **List:** the shared `BacklogList` renders one `BacklogRow` per story, ranked by global
 *   `priority`, with the chevron reorder/move controls (see `BacklogList` / `BacklogRow`). Its
 *   controls act over whatever rows are currently shown, so narrowing either filter re-scopes the
 *   single-chevron swaps to the visible neighbours.
 *
 * Must be mounted under a `CodeProvider` (reads `useBacklog`; `BacklogList` reads the actions).
 */
export function Backlog() {
  // Both filters are keyed `'backlog'` so the selections persist across SPA navigation to a board
  // and back. Statuses default to the outstanding states; projects to all of them.
  const { statuses, toggle, isFiltering } = useStatusFilter('backlog', DEFAULT_BACKLOG_STATUSES);
  // Creation order, not the live ranking: a checklist that reshuffles as work is re-ranked is
  // unusable, and the creation slot is what assigns each project its palette colour (ALF-50).
  const projects = useProjects();
  const {
    projectIds,
    toggle: toggleProject,
    isFiltering: isProjectFiltering,
  } = useProjectFilter('backlog', projects);
  // The filter applies exactly when it is OFFERED. With no projects to filter by there is no
  // control (below) and the selection is necessarily empty — which `useBacklog` would otherwise
  // read as the owner's "show nothing", silently blanking the list.
  const hasProjectFilter = projects.length > 0;
  const stories = useBacklog({
    statuses,
    ...(hasProjectFilter ? { projectIds } : {}),
  });

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
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterMenu
            options={ALL_FACTORY_STATES}
            selected={statuses}
            onToggle={toggle}
            isFiltering={isFiltering}
          />
          {projects.length > 0 ? (
            <ProjectFilterMenu
              projects={projects}
              selected={projectIds}
              onToggle={toggleProject}
              isFiltering={isProjectFiltering}
            />
          ) : null}
        </div>
      </div>

      <PrRatio />

      <BacklogList
        stories={stories}
        emptyMessage="No stories yet. Send a story to the Code module from your inbox to start ranking your backlog."
      />
    </div>
  );
}
