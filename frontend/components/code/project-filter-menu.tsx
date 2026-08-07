'use client';

import { GitBranch } from 'lucide-react';
import * as React from 'react';

import { CheckboxFilterMenu, type FilterOption } from '@/components/atoms/checkbox-filter-menu';
import { projectColorAt, projectTextClasses } from '@/lib/code/project-color';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ProjectFilterMenuProperties {
  /**
   * The projects offered as checkboxes. Pass them in CREATION order (`useProjects`), not the
   * live ranking — a checklist whose rows reshuffle as work is re-ranked is unusable, and the
   * creation slot is also what assigns each project its palette colour (ALF-50).
   */
  projects: Project[];
  /** The ids of the projects currently shown. */
  selected: readonly string[];
  /** Toggle one project in or out of the selection. */
  onToggle: (projectId: string) => void;
  /** Whether the selection differs from "every project" — surfaces the teal highlight + a count. */
  isFiltering: boolean;
}

/**
 * The Backlog's "Filter by project" dropdown (ALF-156): one checkbox per project, each carrying
 * the project's own palette colour on a `GitBranch` glyph so the menu reads with the same tinted
 * treatment as the row badges and the sidebar. The caller owns the selection (see
 * `useProjectFilter`).
 */
export function ProjectFilterMenu({
  projects,
  selected,
  onToggle,
  isFiltering,
}: ProjectFilterMenuProperties) {
  const options = React.useMemo<readonly FilterOption<string>[]>(
    () =>
      projects.map((project, index) => ({
        value: project.id,
        label: (
          <span className="flex items-center gap-1.5">
            <GitBranch
              size={13}
              className={cn('shrink-0', projectTextClasses(projectColorAt(index)))}
            />
            {project.name}
          </span>
        ),
      })),
    [projects],
  );

  return (
    <CheckboxFilterMenu
      label="Filter by project"
      options={options}
      selected={selected}
      onToggle={onToggle}
      isFiltering={isFiltering}
    />
  );
}
