'use client';

import { Badge } from '@/components/atoms/badge';
import { PickerChip } from '@/components/atoms/picker-chip';
import { projectBadgeClasses, projectColorFor } from '@/lib/code/project-color';
import { useProjects } from '@/lib/stores/code-store';
import { cn } from '@/lib/utils';

interface ProjectKeyChipProperties {
  /** The assigned project's id (an item's `intended_project_id`). */
  projectId: string;
  /**
   * Persist a different project, or null to clear (auto-save through `setIntendedProject`, which
   * clears the epic hint in the same PATCH). Pass it to make the chip clickable — it then opens
   * the same project picker the detail panel uses. Omit for a display-only pill (the select-mode
   * row, where the whole row is one button).
   */
  onSelect?: (projectId: string | null) => void;
}

/**
 * A small pill showing a code inbox item's assigned project by its `key`, tinted with the
 * project's colour (the same positional palette the backlog badge and ProjectNav use). Sits
 * beside the Code type badge so the owner sees which project was assigned at a glance. Renders
 * nothing when the project isn't in the store (e.g. it was just deleted). Follows the
 * DueDateChip handler-present-means-editable convention.
 */
export function ProjectKeyChip({ projectId, onSelect }: ProjectKeyChipProperties) {
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectId);
  if (project === undefined) return null;
  const color = projectColorFor(projects, projectId);
  const classes = cn('font-mono font-medium', projectBadgeClasses(color));

  if (onSelect === undefined) {
    return (
      <Badge variant="plain" className={classes}>
        {project.key}
      </Badge>
    );
  }

  return (
    <PickerChip
      trigger={
        <Badge
          asButton
          interactive
          variant="plain"
          aria-label={`Project: ${project.key}`}
          className={cn(classes, 'hover:opacity-80')}
        >
          {project.key}
        </Badge>
      }
      value={projectId}
      options={[
        { value: null, label: 'No project' },
        ...projects.map((p) => ({
          value: p.id,
          label: (
            <>
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{p.key}</span>
            </>
          ),
        })),
      ]}
      onSelect={onSelect}
    />
  );
}
