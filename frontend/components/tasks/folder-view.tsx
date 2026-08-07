'use client';

import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { CollapseAllButton } from '@/components/tasks/collapse-all-button';
import { FolderSortMenu } from '@/components/tasks/folder-sort-menu';
import { TaskList } from '@/components/tasks/task-list';
import { useFolderSort } from '@/lib/stores/folder-sort-store';
import { useFolders } from '@/lib/stores/folders-store';

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
 * The header carries the folder's own sort choice: which signal leads the ranking of its
 * top-level rows, priority or the due date. It is read from the FolderSortProvider rather than
 * held here, since this component is remounted on every view switch.
 */
export function FolderView({ folderId }: FolderViewProperties) {
  const folder = useFolders().find((candidate) => candidate.id === folderId);
  const { mode, setMode } = useFolderSort(folderId);

  if (!folder) {
    return <EmptyState title="Folder not found" description="It may have been deleted." />;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <FolderSortMenu value={mode} onChange={setMode} />
          <CollapseAllButton scope={{ type: 'folder', folderId }} />
        </div>
      </div>

      <TaskList
        scope={{ type: 'folder', folderId }}
        sortMode={mode}
        emptyMessage={`No tasks in ${folder.name}`}
      />
    </>
  );
}
