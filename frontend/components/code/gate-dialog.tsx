'use client';

import { Check, Plus } from 'lucide-react';
import { Dialog } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { NewEpicDialog } from '@/components/code/new-epic-dialog';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api-client';
import type { CodeItem, Epic, Project } from '@/lib/types';
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
  /** The inbox/task row being sent into the factory. */
  item: GateItem;
  /**
   * Called with the created `code_items` sidecar after a successful gate. The caller
   * (task-row) removes the gated item from the tasks store and toasts the ref (§8.3).
   */
  onComplete: (story: CodeItem) => void;
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
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors duration-100 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
        selected
          ? 'bg-accent-teal/15 text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
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
    </button>
  );
}

/** A "+ New …" affordance at the foot of a selector list. */
function AddNewRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-accent-teal transition-colors duration-100 hover:bg-accent-teal/10 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
    >
      <Plus size={14} className="shrink-0" />
      {label}
    </button>
  );
}

/**
 * The gate's stateful body — a separate component so it MOUNTS FRESH each time the dialog
 * opens (Radix only renders Content while open). Mounting fresh resets the selection
 * without a setState-in-effect, and the project fetch runs once on mount.
 */
function GateForm({ item, onOpenChange, onComplete }: Omit<GateDialogProperties, 'open'>) {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [epics, setEpics] = React.useState<Epic[]>([]);
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [epicId, setEpicId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const [newEpicOpen, setNewEpicOpen] = React.useState(false);

  // Fetch the project list once on mount (the async `.then` setState is not a synchronous
  // effect write). Epics load when a project is chosen — but that selection is cleared in
  // the select handler, not an effect, to avoid a synchronous effect setState.
  React.useEffect(() => {
    let cancelled = false;
    void api
      .listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load projects.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the chosen project's epics. The effect only fetches; `epicId` is reset by the
  // project-select handler below, so nothing is set synchronously here.
  React.useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void api
      .listEpics(projectId)
      .then((rows) => {
        if (!cancelled) setEpics(rows);
      })
      .catch(() => {
        if (!cancelled) setEpics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;
  const epicsForProject = epics.filter((e) => e.project_id === projectId);
  const canConfirm = projectId !== null && epicId !== null && !isConfirming;

  // Picking a (different) project clears the epic selection + list — done in the handler,
  // not an effect, so there's no synchronous effect setState (react-hooks/set-state-in-effect).
  const selectProject = (id: string) => {
    if (id === projectId) return;
    setProjectId(id);
    setEpicId(null);
    setEpics([]);
  };

  const handleProjectCreated = (project: Project) => {
    // Optimistic insert into the local combobox + auto-select it.
    setProjects((current) =>
      current.some((p) => p.id === project.id) ? current : [...current, project],
    );
    selectProject(project.id);
  };

  const handleEpicCreated = (epic: Epic) => {
    setEpics((current) => (current.some((e) => e.id === epic.id) ? current : [...current, epic]));
    setEpicId(epic.id);
  };

  const handleConfirm = async () => {
    if (projectId === null || epicId === null) return;
    setConfirmError(null);
    setIsConfirming(true);
    try {
      const story = await api.enterCodeModule(item.id, projectId, epicId);
      onComplete(story);
      onOpenChange(false);
    } catch {
      setConfirmError('Could not send to the Code module. Try again.');
      setIsConfirming(false);
    }
  };

  return (
    <>
      <Dialog.Title className="text-base font-semibold text-foreground">
        Send to Code module
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        Assign <span className="font-medium text-foreground">&ldquo;{item.title}&rdquo;</span> to a
        project and epic. It will leave your tasks and enter the factory at Needs Refinement.
      </Dialog.Description>

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
            {loadError !== null && (
              <p className="px-3 py-2 text-sm text-destructive">{loadError}</p>
            )}
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
          onClick={() => {
            void handleConfirm();
          }}
          disabled={!canConfirm}
          className="bg-accent-teal text-background hover:bg-accent-teal/90"
        >
          {isConfirming ? 'Sending…' : 'Send to Code module'}
        </Button>
      </div>

      {/* Nested create dialogs — gate context, so they persist via api-client directly. */}
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreateProject={(input) => api.createProject(input)}
        onCreated={handleProjectCreated}
        existingKeys={projects.map((p) => p.key)}
      />
      {selectedProject !== null && (
        <NewEpicDialog
          open={newEpicOpen}
          onOpenChange={setNewEpicOpen}
          projectName={selectedProject.name}
          onCreateEpic={(name) => api.createEpic(selectedProject.id, name)}
          onCreated={handleEpicCreated}
        />
      )}
    </>
  );
}

/**
 * The gate (§8): a Radix Dialog that admits an item to the Software Factory. Entered from
 * either "Send to Code module…" (a code-classified inbox item) or "Convert to Code
 * Story…" (a task). The user picks a Project then an Epic (both blank until chosen; both
 * offer "+ New …"); Confirm is disabled until BOTH are set, then calls `enter_code_module`.
 *
 * It is deliberately CodeProvider-free: it's mounted in the Tasks view, so it fetches
 * projects on open and holds its own project/epic lists, calling `lib/api-client` directly.
 * New project/epic creations insert optimistically into these local lists (a temp id) and
 * reconcile with the server row. See the data-flow skill + §8.
 */
export function GateDialog({ open, onOpenChange, item, onComplete }: GateDialogProperties) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface p-6',
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
          )}
        >
          <GateForm item={item} onOpenChange={onOpenChange} onComplete={onComplete} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
