'use client';

import { ListCollapse } from 'lucide-react';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { TaskList } from '@/components/tasks/task-list';
import { useFolders } from '@/lib/stores/folders-store';
import { TaskCollapseContext, useCollapseAll } from '@/lib/task-collapse-context';

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
  const { subscribe, collapseAll } = useCollapseAll();
  const folder = useFolders().find((candidate) => candidate.id === folderId);

  if (!folder) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="font-serif text-2xl text-muted-foreground/50">Folder not found</p>
        <p className="mt-2 text-sm text-muted-foreground/40">It may have been deleted.</p>
      </div>
    );
  }

  return (
    <TaskCollapseContext.Provider value={{ subscribe }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
        <IconButton
          size="sm"
          className="ml-auto"
          onClick={collapseAll}
          aria-label="Collapse all tasks"
        >
          <ListCollapse size={14} />
        </IconButton>
      </div>

      <TaskList scope={{ type: 'folder', folderId }} emptyMessage={`No tasks in ${folder.name}`} />
    </TaskCollapseContext.Provider>
  );
}
