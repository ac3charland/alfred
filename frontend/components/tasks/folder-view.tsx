'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightReveal } from '@/components/atoms/animated-height-reveal';
import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { IconButton } from '@/components/atoms/icon-button';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CollapseAllButton } from '@/components/tasks/collapse-all-button';
import { TaskList } from '@/components/tasks/task-list';
import { captureRevealClass } from '@/components/tasks/task-row.styles';
import {
  sameEditor,
  useActiveEditor,
  useActiveEditorActions,
} from '@/lib/stores/active-editor-store';
import { useFolders } from '@/lib/stores/folders-store';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

interface FolderViewProperties {
  /** The folder whose active tasks to show, taken from the URL by TaskViews. */
  folderId: string;
}

/**
 * A single folder's active tasks, derived entirely from the shared stores. The folder
 * name comes from the FoldersProvider (already seeded), so opening a folder needs no
 * server round-trip. An id with no matching folder — e.g. a stale deep link, or the
 * folder you just deleted — shows a not-found message instead of a server 404.
 *
 * The header's "+" is the folder's own capture affordance: it reveals the same compact
 * CaptureBox the row-level "Add subtask" renders, wired to this folder, so a thought that
 * already belongs here is filed without a trip through the Inbox. Whether that box is open
 * lives in the ActiveEditorProvider (keyed by the FOLDER's id), so it holds the same
 * single-open-input slot as every row's inline editor.
 */
export function FolderView({ folderId }: FolderViewProperties) {
  const folder = useFolders().find((candidate) => candidate.id === folderId);
  const editor = { itemId: folderId, kind: 'folder-capture' } as const;
  const showCapture = sameEditor(useActiveEditor(), editor);
  const { openEditor, closeEditor } = useActiveEditorActions();
  const prefersReducedMotion = usePrefersReducedMotion();

  // The box animates in and back out, so it must stay mounted through its exit — an unmount
  // would kill the animation. Derive the render flag DURING RENDER (React's recommended
  // pattern over a setState-in-effect): mount as soon as it opens, and drop it here only
  // under reduced motion, where no animation runs and so no `animationend` ever arrives.
  // The animated path drops it on the reveal's onExited.
  const [captureRendered, setCaptureRendered] = React.useState(showCapture);
  if (showCapture && !captureRendered) {
    setCaptureRendered(true);
  } else if (!showCapture && captureRendered && prefersReducedMotion) {
    setCaptureRendered(false);
  }

  const openCapture = () => {
    openEditor(editor);
  };
  const dismissCapture = () => {
    closeEditor(editor);
  };

  if (!folder) {
    return <EmptyState title="Folder not found" description="It may have been deleted." />;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
        <div className="flex items-center gap-1">
          {/* The capture toggle, in the same grey treatment as its neighbour so the pair reads
              as one cluster. Present at every width: the folder header has no overflow menu to
              fold into (unlike the row's "+") and its actions are never hover-gated. */}
          <IconButton
            aria-label={`Add task to ${folder.name}`}
            title="Add task"
            aria-expanded={showCapture}
            onMouseDown={(event) => {
              // Keep focus inside the open box until the click lands. Without this the box's
              // blur-dismiss fires first, so the click handler sees a closed box and re-opens
              // what it just closed — the same trap the row's "+" guards against.
              if (showCapture) event.preventDefault();
            }}
            onClick={() => {
              if (showCapture) {
                closeEditor(editor);
              } else {
                openEditor(editor);
              }
            }}
          >
            <Plus size={16} />
          </IconButton>
          <CollapseAllButton scope={{ type: 'folder', folderId }} />
        </div>
      </div>

      {captureRendered && (
        <AnimatedHeightReveal
          open={showCapture}
          onExited={() => {
            setCaptureRendered(false);
          }}
          className={captureRevealClass}
        >
          {/* No project-prefix parsing here (unlike the Inbox hero box): a `<project>:` prefix
              would classify the capture as Code and strip the folder — the opposite of filing. */}
          <CaptureBox
            compact
            folderId={folderId}
            placeholder="Add task…"
            onDismiss={dismissCapture}
          />
        </AnimatedHeightReveal>
      )}

      <TaskList
        scope={{ type: 'folder', folderId }}
        emptyMessage={`No tasks in ${folder.name}`}
        emptyDescription="Add your first task to this folder."
        // The empty state's way in is withheld while the box is open — it opens the very box
        // already on screen, so leaving it there would be a control that does nothing.
        // Spread conditionally rather than passing `undefined` (exactOptionalPropertyTypes).
        {...(showCapture
          ? {}
          : {
              emptyAction: (
                <Button variant="ghostAccent" size="sm" onClick={openCapture}>
                  Add task
                </Button>
              ),
            })}
      />
    </>
  );
}
