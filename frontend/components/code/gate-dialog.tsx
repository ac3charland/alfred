'use client';

import { Check, Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { OptionButton } from '@/components/atoms/option-button';
import { NewEpicDialog } from '@/components/code/new-epic-dialog';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useCodeActions, useEpics, useProjects } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The item being admitted to the factory — the fields the optimistic card needs. */
export interface GateItem {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
}

interface GateDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The inbox/task row(s) being sent into the factory. A single-row caller passes a
   * one-element array; the Inbox bulk bar passes the whole selection — one project + epic
   * admits every item.
   */
  items: GateItem[];
  /**
   * Called with the created code stories after a successful gate. The caller removes the
   * gated items from the tasks store and toasts the outcome.
   */
  onComplete: (stories: CodeStory[]) => void;
}

/** One selectable option in a combobox-style list (a project or an epic). */
function OptionRow({
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
function AddNewRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <OptionButton kind="action" onClick={onClick}>
      <Plus size={14} className="shrink-0" />
      {label}
    </OptionButton>
  );
}

/**
 * The gate's stateful body — a separate component so it MOUNTS FRESH each time the dialog
 * opens (Radix only renders Content while open). Mounting fresh resets the selection without
 * a setState-in-effect.
 *
 * Since ALF-27 the CodeProvider wraps the Tasks view too, so the gate reads the project/epic
 * lists straight from the store and routes its creates + the gated story through
 * `useCodeActions` — no local fetch, and the new story lands on the board with no refetch.
 */
function GateForm({ items, onOpenChange, onComplete }: Omit<GateDialogProperties, 'open'>) {
  const projects = useProjects();
  const epics = useEpics();
  const { createProject, createEpic, convertTaskToCode } = useCodeActions();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [epicId, setEpicId] = React.useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const [newEpicOpen, setNewEpicOpen] = React.useState(false);

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;
  const epicsForProject = epics.filter((e) => e.project_id === projectId);

  const {
    error: confirmError,
    isPending: isConfirming,
    submit: handleConfirm,
  } = useFormSubmit({
    // Route through the store so the optimistic card(s) land on the board with no refetch.
    // The button is disabled until both ids are set, so the assertions hold when it runs.
    // One project + epic for the whole batch; a single-item caller just passes [item].
    onSubmit: () =>
      Promise.all(items.map((it) => convertTaskToCode(it, projectId ?? '', epicId ?? ''))),
    onSuccess: (stories) => {
      onComplete(stories);
      onOpenChange(false);
    },
    errorMessage: 'Could not send to the Code module. Try again.',
  });

  const canConfirm = projectId !== null && epicId !== null && !isConfirming;

  // Picking a (different) project clears the epic selection. The epic list is derived from
  // the store by project_id, so there's nothing to clear — switching projects instantly shows
  // the right epics.
  const selectProject = (id: string) => {
    if (id === projectId) return;
    setProjectId(id);
    setEpicId(null);
  };

  const handleProjectCreated = (project: Project) => {
    // The store already inserted it optimistically; just auto-select it.
    selectProject(project.id);
  };

  const handleEpicCreated = (epic: Epic) => {
    setEpicId(epic.id);
  };

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        Send to Code module
      </DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        {items.length === 1 ? (
          <>
            Assign{' '}
            <span className="font-medium text-foreground">&ldquo;{items[0]?.title}&rdquo;</span> to
            a project and epic. It will leave your tasks and enter the factory at Needs Refinement.
          </>
        ) : (
          <>
            Assign these <span className="font-medium text-foreground">{items.length} items</span>{' '}
            to a project and epic. They will leave your tasks and enter the factory at Needs
            Refinement.
          </>
        )}
      </DialogDescription>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {/* Project selector */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="gate-project-list">Project</FieldLabel>
          <div
            id="gate-project-list"
            role="listbox"
            aria-label="Project"
            className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-sm border border-border bg-input/40 p-1"
          >
            {projects.map((project) => (
              <OptionRow
                key={project.id}
                selected={project.id === projectId}
                label={project.name}
                hint={project.key}
                onSelect={() => {
                  selectProject(project.id);
                }}
              />
            ))}
            <AddNewRow
              label="New project…"
              onClick={() => {
                setNewProjectOpen(true);
              }}
            />
          </div>
        </div>

        {/* Epic selector — only meaningful once a project is chosen. */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="gate-epic-list">Epic</FieldLabel>
          {projectId === null ? (
            <p className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              Pick a project first.
            </p>
          ) : (
            <div
              id="gate-epic-list"
              role="listbox"
              aria-label="Epic"
              className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-sm border border-border bg-input/40 p-1"
            >
              {epicsForProject.map((epic) => (
                <OptionRow
                  key={epic.id}
                  selected={epic.id === epicId}
                  label={epic.name}
                  hint={epic.ref === '' ? undefined : epic.ref}
                  onSelect={() => {
                    setEpicId(epic.id);
                  }}
                />
              ))}
              <AddNewRow
                label="New epic…"
                onClick={() => {
                  setNewEpicOpen(true);
                }}
              />
            </div>
          )}
        </div>

        {confirmError !== null && <p className="text-xs text-destructive">{confirmError}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChange(false);
          }}
          disabled={isConfirming}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            void handleConfirm();
          }}
          disabled={!canConfirm}
        >
          {isConfirming ? 'Sending…' : 'Send to Code module'}
        </Button>
      </div>

      {/* Nested create dialogs — routed through the store's optimistic actions so the new
          project/epic land in the CodeProvider the board reads from. */}
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreateProject={(input) => createProject(input)}
        onCreated={handleProjectCreated}
        existingKeys={projects.map((p) => p.key)}
      />
      {selectedProject !== null && (
        <NewEpicDialog
          open={newEpicOpen}
          onOpenChange={setNewEpicOpen}
          projectName={selectedProject.name}
          onCreateEpic={(name) => createEpic(selectedProject.id, name)}
          onCreated={handleEpicCreated}
        />
      )}
    </>
  );
}

/**
 * The gate: a Radix Dialog that admits an item to the Software Factory. Entered from
 * either "Send to Code module…" (a code-classified inbox item) or "Convert to Code
 * Story…" (a task). The user picks a Project then an Epic (both blank until chosen; both
 * offer "+ New …"); Confirm is disabled until BOTH are set, then calls `enter_code_module`.
 *
 * Since ALF-27 the CodeProvider is seeded at the shared shell layout, so it wraps the Tasks
 * view too: the gate reads the project/epic lists from the store and routes its creates + the
 * gated story through `useCodeActions`, so the new card lands on the board with no refetch
 * after a (now client-side) module switch. See the data-flow skill.
 */
export function GateDialog({ open, onOpenChange, items, onComplete }: GateDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      className="flex max-h-[85vh] flex-col"
    >
      <GateForm items={items} onOpenChange={onOpenChange} onComplete={onComplete} />
    </FormDialog>
  );
}
