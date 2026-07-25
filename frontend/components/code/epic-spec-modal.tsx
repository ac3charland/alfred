'use client';

import { DialogClose, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { SpecView } from '@/components/code/spec-view';
import { specBlobUrl } from '@/lib/code/links';
import { useProjects } from '@/lib/stores/code-store';
import type { Epic } from '@/lib/types';

/** The modal body — split out so it MOUNTS FRESH each open (Radix only renders while open). */
function EpicSpecBody({ epic }: { epic: Epic }) {
  const projects = useProjects();
  // The epic's repo coordinates live on its project (unlike a story, whose joined view row
  // carries them), so resolve the project from the store.
  const project = projects.find((candidate) => candidate.id === epic.project_id);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <DialogTitle className="text-base font-semibold text-foreground">
          <span className="font-mono text-sm font-medium text-accent-teal">{epic.ref}</span>{' '}
          {epic.name}
        </DialogTitle>
        <DialogClose
          aria-label="Close"
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </DialogClose>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SpecView
          spec={epic.spec_markdown}
          repoUrl={specBlobUrl({
            repoOwner: project?.repo_owner ?? null,
            repoName: project?.repo_name ?? null,
            specPath: epic.spec_path,
            specSha: epic.spec_sha,
          })}
          emptyCopy="No epic spec yet. Refine the epic in Claude Code to write one."
        />
      </div>
    </>
  );
}

export interface EpicSpecModalProperties {
  /** The epic whose spec to show; `null` keeps the modal closed. */
  epic: Epic | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The read-only epic spec modal, opened from the epic 3-dot menu's "View spec". Renders the
 * Worker-snapshotted epic spec through the same view the story detail modal uses — an HTML plan in
 * a sandboxed frame, legacy markdown as prose — with a sha-pinned "View in repo" link.
 *
 * Read-only by design: an epic spec is edited by running another epic-refinement session, whose PR
 * re-snapshots it, exactly as story specs work. Must be mounted under a `CodeProvider` (it reads
 * `useProjects` for the repo coordinates).
 */
export function EpicSpecModal({ epic, open, onOpenChange }: EpicSpecModalProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="2xl"
      className="flex max-h-[85vh] flex-col"
      aria-describedby={undefined}
    >
      {epic === null ? (
        <DialogTitle className="sr-only">Epic spec</DialogTitle>
      ) : (
        <EpicSpecBody epic={epic} />
      )}
    </FormDialog>
  );
}
