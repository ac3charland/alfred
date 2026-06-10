import { notFound } from 'next/navigation';
import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { getFolder } from '@/lib/data/folders';

interface FolderPageProperties {
  params: Promise<{ id: string }>;
}

/**
 * Folder view — active items scoped to this folder, filtered from the shared store.
 * Only the folder itself is fetched here (for the title + a real 404).
 */
export default async function FolderPage({ params }: FolderPageProperties) {
  const { id } = await params;

  const folder = await getFolder(id);
  if (!folder) {
    notFound();
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
      </div>

      <TaskList
        scope={{ type: 'folder', folderId: id }}
        emptyMessage={`No tasks in ${folder.name}`}
      />
    </>
  );
}
