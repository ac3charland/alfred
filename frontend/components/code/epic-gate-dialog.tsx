'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { ProjectPicker } from '@/components/code/project-picker';
import type { ConvertedEpic } from '@/lib/api-client';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useCodeActions, useProjects } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

/** The 1-deep parent being converted — the fields the epic takes over. */
export interface EpicGateParent {
  id: string;
  title: string;
  notes: string | null;
}

/** One child of the parent, in display order — each becomes a story. */
export interface EpicGateChild {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
}

interface EpicGateDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: EpicGateParent;
  /** The parent's active children in display order — the stories the conversion creates. */
  childItems: EpicGateChild[];
  /**
   * Called with the conversion result after a successful convert. The caller settles the
   * tasks store (`settleEpicConversion`) and toasts the outcome.
   */
  onComplete: (result: ConvertedEpic) => void;
}

/**
 * The epic gate's stateful body — a separate component so it MOUNTS FRESH each time the
 * dialog opens (Radix only renders Content while open), resetting the selection without a
 * setState-in-effect (the same seam as `GateForm`).
 */
function EpicGateForm({
  parent,
  childItems,
  onOpenChange,
  onComplete,
}: Omit<EpicGateDialogProperties, 'open'>) {
  const projects = useProjects();
  const { createProject, convertToCodeEpic } = useCodeActions();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);

  const {
    error: confirmError,
    isPending: isConfirming,
    submit: handleConfirm,
  } = useFormSubmit({
    // Route through the store so the optimistic epic + cards land on the board with no
    // refetch. The button is disabled until a project is set, so the assertion holds.
    onSubmit: () => convertToCodeEpic(parent, childItems, projectId ?? ''),
    onSuccess: (result) => {
      onComplete(result);
      onOpenChange(false);
    },
    errorMessage: 'Could not send to the Code module. Try again.',
  });

  const canConfirm = projectId !== null && !isConfirming;

  const handleProjectCreated = (project: Project) => {
    // The store already inserted it optimistically; just auto-select it.
    setProjectId(project.id);
  };

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        Send to Code module
      </DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        Creates a new epic and {childItems.length} {childItems.length === 1 ? 'story' : 'stories'}{' '}
        at the top of the project&rsquo;s backlog.
      </DialogDescription>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {/* Project selector — the only choice; the epic is being CREATED, so there is no epic
            picker (unlike the story gate). */}
        <ProjectPicker
          selectedProjectId={projectId}
          onSelectProject={setProjectId}
          onNewProject={() => {
            setNewProjectOpen(true);
          }}
        />

        {/* Read-only preview of what the conversion creates: the epic (the parent's title) and
            its ordered stories. */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="epic-gate-preview">New epic</FieldLabel>
          <div
            id="epic-gate-preview"
            data-testid="epic-gate-preview"
            className="rounded-sm border border-border bg-input/40 px-3 py-2 text-sm"
          >
            <p className="font-medium text-foreground">&ldquo;{parent.title}&rdquo;</p>
            <ol className="mt-1.5 list-inside list-decimal text-muted-foreground">
              {childItems.map((child) => (
                <li key={child.id} className="truncate">
                  {child.title}
                </li>
              ))}
            </ol>
          </div>
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
          {isConfirming ? 'Sending…' : 'Send to Code'}
        </Button>
      </div>

      {/* Nested create dialog — routed through the store's optimistic action so the new
          project lands in the CodeProvider the board reads from. */}
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreateProject={(input) => createProject(input)}
        onCreated={handleProjectCreated}
        existingKeys={projects.map((p) => p.key)}
      />
    </>
  );
}

/**
 * The epic gate (ALF-129): a sibling of `GateDialog` for converting a 1-deep code parent that
 * carries no intended project into a new epic plus its ordered stories — where the row menu's
 * Dispatch lands when the target still has to be asked for. A project picker plus a read-only
 * preview — there is no epic picker, because the epic is being created. Confirm is disabled
 * until a project is chosen; on confirm it calls the store's `convertToCodeEpic` and hands the
 * result to `onComplete`.
 */
export function EpicGateDialog({
  open,
  onOpenChange,
  parent,
  childItems,
  onComplete,
}: EpicGateDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      className="flex max-h-[85vh] flex-col"
    >
      <EpicGateForm
        parent={parent}
        childItems={childItems}
        onOpenChange={onOpenChange}
        onComplete={onComplete}
      />
    </FormDialog>
  );
}
