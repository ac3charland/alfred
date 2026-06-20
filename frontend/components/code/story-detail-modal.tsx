'use client';

import { Pencil } from 'lucide-react';

import { Badge } from '@/components/atoms/badge';
import { DialogClose, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { EditableTextField } from '@/components/atoms/editable-text-field';
import { ManualControls } from '@/components/code/story-detail/manual-controls';
import { PrLink } from '@/components/code/story-detail/pr-link';
import { PrimaryAction } from '@/components/code/story-detail/primary-action';
import { SpecBody } from '@/components/code/story-detail/spec-body';
import { stateLabel } from '@/components/code/story-detail/state-helpers';
import type { LaunchPhase } from '@/lib/code/launch';
import { useCodeActions, useProjects } from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory, Project } from '@/lib/types';

/** The factory-state chip, tinted per happy-path / blocked / abandoned. */
function StateChip({ state }: { state: CodeFactoryState | null }) {
  const variant = state === 'blocked' ? 'alert' : state === 'abandoned' ? 'destructive' : 'accent';
  return (
    <Badge
      variant={variant}
      data-factory-state={state ?? undefined}
      className="font-semibold uppercase tracking-wide"
    >
      {stateLabel(state)}
    </Badge>
  );
}

/**
 * The inline-editable title (reusing task-row's edit pattern): a double-click / pencil
 * opens an input; Enter or the check commits via `updateStoryTitle`, Escape / blur reverts.
 */
function EditableTitle({ story }: { story: CodeStory }) {
  const { updateStoryTitle } = useCodeActions();
  const currentTitle = story.title ?? '';
  const itemId = story.item_id;

  return (
    <EditableTextField
      value={currentTitle}
      onSave={async (next) => {
        // A view row may have a null item_id; nothing to PATCH then.
        if (itemId === null) return;
        await updateStoryTitle(itemId, next);
      }}
      label="Edit title"
      inputClassName="text-lg font-semibold"
      selectAllOnEdit={false}
    >
      <DialogTitle className="text-lg font-semibold text-foreground">{currentTitle}</DialogTitle>
      <Pencil
        size={13}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/editable:opacity-100 motion-reduce:transition-none"
      />
    </EditableTextField>
  );
}

/** The modal body — split out so it MOUNTS FRESH each open (Radix only renders while open). */
function DetailBody({
  story,
  project,
  onOpenSession,
}: {
  story: CodeStory;
  project: Project | undefined;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}) {
  const projectName = project?.name ?? story.project_name ?? 'Project';
  const epicName = story.epic_name ?? 'Epic';
  const notes = story.notes?.trim();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-accent-teal">{story.ref}</span>
            <StateChip state={story.factory_state} />
          </div>
          <EditableTitle story={story} />
          <p className="text-xs text-muted-foreground">
            {projectName} <span aria-hidden="true">›</span> {epicName}
          </p>
        </div>
        <DialogClose
          aria-label="Close"
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </DialogClose>
      </div>

      {/* The primary launch action sits in the header region. */}
      <div className="mt-4 flex items-center gap-3">
        <PrimaryAction story={story} onOpenSession={onOpenSession} />
        {story.refinement_pr_url === null ? null : (
          <PrLink label="Refinement PR" url={story.refinement_pr_url} />
        )}
        {story.implementation_pr_url === null ? null : (
          <PrLink label="Implementation PR" url={story.implementation_pr_url} />
        )}
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {/* Notes — generic on any item. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </h3>
          {notes === undefined || notes === '' ? (
            <p className="text-sm text-muted-foreground/70">No notes.</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">{notes}</p>
          )}
        </div>

        <SpecBody story={story} />
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <ManualControls story={story} />
      </div>
    </>
  );
}

export interface StoryDetailModalProperties {
  /** The story to show; `null` keeps the modal closed (it opens when a card is clicked). */
  story: CodeStory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The human-launch handler the board threads in (the store's `openClaudeSession`), so
   * the modal's primary action reuses the await-write-then-open launch verbatim.
   */
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * The Jira-style story detail modal: a Radix Dialog (modelled on `cascade-modal` /
 * `gate-dialog`, sized up) opened from a board card. Shows the ref + inline-editable title,
 * the Project › Epic breadcrumb, the factory-state chip, notes, the rendered spec markdown
 * (react-markdown + remark-gfm) with a "View in repo" link, PR links, the phase-appropriate
 * "Open Claude Code" launch button, and the manual fallback controls.
 *
 * Must be mounted under a `CodeProvider` — it reads `useCodeActions` for the title edit and
 * the manual transitions. The board owns the open story + the `onOpenSession` handler. The
 * header chip, primary action, spec body, and manual controls are their own sub-components
 * under `code/story-detail/`; this file is the composition root.
 */
export function StoryDetailModal({
  story,
  open,
  onOpenChange,
  onOpenSession,
}: StoryDetailModalProperties) {
  const projects = useProjects();
  // Resolve the project from the store for the breadcrumb (the view row also carries a name,
  // used as the fallback). Read it here so the body stays a pure function of its props.
  const project = story === null ? undefined : projects.find((p) => p.id === story.project_id);

  // Reuses FormDialog (the shared Root → Portal → DialogOverlay → Content scaffold), sized to
  // `2xl` with the scrollable flex body — same shell as gate-dialog. `aria-describedby` is
  // suppressed (no Description element); the Close button + Title live in DetailBody.
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="2xl"
      className="flex max-h-[85vh] flex-col"
      aria-describedby={undefined}
    >
      {story === null ? (
        <DialogTitle className="sr-only">Story details</DialogTitle>
      ) : (
        <DetailBody story={story} project={project} onOpenSession={onOpenSession} />
      )}
    </FormDialog>
  );
}
