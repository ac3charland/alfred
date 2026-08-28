'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { NewEpicDialog } from '@/components/code/new-epic-dialog';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { AddNewRow, OptionRow, ProjectPicker } from '@/components/code/project-picker';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useCodeActions, useEpics, useProjects } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

/** The item being admitted to the factory — the fields the optimistic card needs. */
export interface GateItem {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
  /** The project pre-assigned at capture via a prefix, if any — pre-selects (and, in bulk, locks) the gate. */
  intendedProjectId: string | null;
  /** The pre-factory epic hint, if any — pre-selects the epic when the batch is unanimous, never locks it. */
  intendedEpicId: string | null;
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
  // The project every selected item already carries, when they unanimously share one non-null
  // intended project (set at capture via a prefix). Pre-selects the picker; in bulk it also locks
  // it. A single item is just the one-element case, so this pre-selects its intended project too.
  const firstIntended = items[0]?.intendedProjectId ?? null;
  const unanimousProjectId =
    items.length > 0 && items.every((it) => it.intendedProjectId === firstIntended)
      ? firstIntended
      : null;
  // Lock only a BULK send whose whole selection shares one project — render it as a read-only
  // chip and let the user pick only the epic. A single item stays user-changeable.
  const projectLocked = items.length > 1 && unanimousProjectId !== null;
  // The epic pre-selects by the same unanimity rule — but is NEVER locked: the epic list is
  // right there in the dialog, and picking a different project already clears it, so a lock
  // would only stop the owner changing their mind in the one place they came to change it.
  const firstIntendedEpic = items[0]?.intendedEpicId ?? null;
  const unanimousEpicId =
    items.length > 0 && items.every((it) => it.intendedEpicId === firstIntendedEpic)
      ? firstIntendedEpic
      : null;
  const [projectId, setProjectId] = React.useState<string | null>(unanimousProjectId);
  const [epicId, setEpicId] = React.useState<string | null>(unanimousEpicId);
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
        {/* Project selector — a read-only chip when the bulk selection unanimously shares one
            assigned project (the user only picks the epic); otherwise the interactive list. */}
        <ProjectPicker
          selectedProjectId={projectId}
          locked={projectLocked}
          onSelectProject={selectProject}
          onNewProject={() => {
            setNewProjectOpen(true);
          }}
        />

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
 * The gate: a Radix Dialog that admits an item to the Software Factory. Entered from the
 * Inbox bulk bar's "Send to Code…" — the "choose the project and epic now" path, and the
 * only one that can create either on the way through (a row whose hints are already set
 * dispatches from its own menu instead). The user picks a Project then an Epic (both blank
 * until chosen; both offer "+ New …"); Confirm is disabled until BOTH are set, then calls
 * `enter_code_module`.
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
