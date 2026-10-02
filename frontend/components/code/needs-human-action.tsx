'use client';

import { UserCheck } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { BacklogList } from '@/components/code/backlog/backlog-list';
import { ProjectFilterMenu } from '@/components/code/project-filter-menu';
import { StatusFilterMenu } from '@/components/code/status-filter-menu';
import { useProjectFilter } from '@/lib/hooks/use-project-filter';
import { useStatusFilter } from '@/lib/hooks/use-status-filter';
import { HUMAN_REVIEW_STATUSES, useBacklog, useProjects } from '@/lib/stores/code-store';

/** The filter-store key — its own, so this view's selections never leak into the Backlog's. */
const FILTER_KEY = 'needs-human-action';

/**
 * The "Needs human action" view — a focused, cross-project queue of every story awaiting the
 * owner's eyes: a spec in review (`in_refinement`) and the two ready-for gates (`ready_for_dev`,
 * `ready_for_review`). Promoted from the Backlog's old "Human Review" filter macro (ALF-103) into
 * its own sidebar destination, so the states that need a human are one click away rather than
 * buried in a filter preset.
 *
 * It is the module's DEFAULT view (ALF-174): both the bare `/code` and the explicit
 * `/code/needs-human-action` render it, and it leads the sidebar above the Backlog. Entering the
 * Code module should open on the work blocked on the owner, not the full ranked backlog.
 *
 * It reuses the Backlog's ranked, reorderable `BacklogList` and the Backlog's two filter dropdowns
 * (ALF-316), scoped to this view: **Filter by status** offers only the three human-review states,
 * all checked at rest, so it can narrow the queue but never widen it past what needs a human; and
 * **Filter by project** rests with nothing checked (every project) until the owner picks some.
 * Both are keyed to this view, so they survive SPA navigation without touching the Backlog's.
 *
 * Must be mounted under a `CodeProvider` (reads `useBacklog`; `BacklogList` reads the actions).
 */
export function NeedsHumanAction() {
  const { statuses, toggle, isFiltering } = useStatusFilter(FILTER_KEY, HUMAN_REVIEW_STATUSES);
  // Creation order, as on the Backlog: the checklist mustn't reshuffle as work is re-ranked.
  const projects = useProjects();
  const {
    projectIds,
    toggle: toggleProject,
    isFiltering: isProjectFiltering,
  } = useProjectFilter(FILTER_KEY);
  // An empty project selection is "no project filter", not "show nothing" (ALF-201).
  const stories = useBacklog({
    statuses,
    ...(projectIds.length > 0 ? { projectIds } : {}),
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewHeading
          icon={UserCheck}
          title="Needs human action"
          description="Stories waiting on your review — a spec to approve or a gate to clear."
          accent="code"
        />
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterMenu
            options={HUMAN_REVIEW_STATUSES}
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

      <BacklogList
        stories={stories}
        emptyMessage={
          isFiltering || isProjectFiltering
            ? 'No stories match these filters. Widen them to see everything waiting on you.'
            : 'Nothing needs your attention right now. Stories waiting on a spec review or a ready-for gate will appear here.'
        }
      />
    </div>
  );
}
