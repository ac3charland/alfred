'use client';

import { Badge } from '@/components/atoms/badge';
import { projectBadgeClasses, projectColorFor } from '@/lib/code/project-color';
import { useProjects } from '@/lib/stores/code-store';
import { cn } from '@/lib/utils';

interface ProjectKeyChipProperties {
  /** The assigned project's id (an item's `intended_project_id`). */
  projectId: string;
}

/**
 * A small read-only pill showing a code inbox item's assigned project by its `key`, tinted with
 * the project's colour (the same positional palette the backlog badge and ProjectNav use). Sits
 * beside the Code type badge so the owner sees which project was assigned at a glance. Renders
 * nothing when the project isn't in the store (e.g. it was just deleted).
 */
export function ProjectKeyChip({ projectId }: ProjectKeyChipProperties) {
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectId);
  if (project === undefined) return null;
  const color = projectColorFor(projects, projectId);
  return (
    <Badge variant="plain" className={cn('font-mono font-medium', projectBadgeClasses(color))}>
      {project.key}
    </Badge>
  );
}
