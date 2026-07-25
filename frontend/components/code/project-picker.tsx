'use client';

import { Check, Plus } from 'lucide-react';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { OptionButton } from '@/components/atoms/option-button';
import { useProjects } from '@/lib/stores/code-store';
import { cn } from '@/lib/utils';

/** One selectable option in a combobox-style list (a project or an epic). */
export function OptionRow({
  selected,
  label,
  hint,
  onSelect,
}: {
  selected: boolean;
  label: string;
  // Explicit `| undefined` (not `?`) so an epic with no ref yet may pass `undefined`
  // directly under exactOptionalPropertyTypes.
  hint: string | undefined;
  onSelect: () => void;
}) {
  return (
    <OptionButton role="option" aria-selected={selected} selected={selected} onClick={onSelect}>
      <span className="flex min-w-0 items-center gap-2">
        <Check
          size={14}
          className={cn('shrink-0 text-accent-teal', selected ? 'opacity-100' : 'opacity-0')}
        />
        <span className="truncate">{label}</span>
      </span>
      {hint !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{hint}</span>
      )}
    </OptionButton>
  );
}

/**
 * A "+ New …" affordance at the foot of a selector list — an action row rather than a
 * selectable option, so it uses `OptionButton`'s `action` kind (left-aligned, all-teal accent
 * with a teal hover wash, no selected state) with a leading `Plus`.
 */
export function AddNewRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <OptionButton kind="action" onClick={onClick}>
      <Plus size={14} className="shrink-0" />
      {label}
    </OptionButton>
  );
}

/**
 * The gate dialogs' shared project selector: the option list with a "+ New project…" foot row,
 * or — when `locked` — a read-only chip showing the already-decided project. Reads the project
 * list from the code store (both gates render inside the shell-seeded CodeProvider). The
 * "+ New project…" row only fires `onNewProject`; the NewProjectDialog itself stays with the
 * caller, which owns the create action and the auto-select on success.
 */
export function ProjectPicker({
  selectedProjectId,
  locked = false,
  onSelectProject,
  onNewProject,
}: {
  selectedProjectId: string | null;
  /** Render the selection as a read-only chip (a bulk send whose items share one project). */
  locked?: boolean;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
}) {
  const projects = useProjects();
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="gate-project-list">Project</FieldLabel>
      {locked && selectedProject !== null ? (
        <div
          data-testid="gate-project-locked"
          className="flex items-center gap-2 rounded-sm border border-border bg-input/40 px-3 py-2 text-sm text-foreground"
        >
          <span className="truncate">{selectedProject.name}</span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {selectedProject.key}
          </span>
        </div>
      ) : (
        <div
          id="gate-project-list"
          role="listbox"
          aria-label="Project"
          className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-sm border border-border bg-input/40 p-1"
        >
          {projects.map((project) => (
            <OptionRow
              key={project.id}
              selected={project.id === selectedProjectId}
              label={project.name}
              hint={project.key}
              onSelect={() => {
                onSelectProject(project.id);
              }}
            />
          ))}
          <AddNewRow label="New project…" onClick={onNewProject} />
        </div>
      )}
    </div>
  );
}
