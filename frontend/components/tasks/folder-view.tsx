'use client';

import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { CollapseAllButton } from '@/components/tasks/collapse-all-button';
import { TaskList } from '@/components/tasks/task-list';
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
 */
export function FolderView({ folderId }: FolderViewProperties) {
  const folder = useFolders().find((candidate) => candidate.id === folderId);

  if (!folder) {
    return <EmptyState title="Folder not found" description="It may have been deleted." />;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
        <CollapseAllButton scope={{ type: 'folder', folderId }} />
      </div>

      <TaskList scope={{ type: 'folder', folderId }} emptyMessage={`No tasks in ${folder.name}`} />
    </>
  );
}
