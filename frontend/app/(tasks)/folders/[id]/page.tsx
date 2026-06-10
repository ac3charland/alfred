import { notFound } from 'next/navigation';
import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { getFolder, getFolders } from '@/lib/data/folders';
import { getFolderItems } from '@/lib/data/items';

interface FolderPageProperties {
  params: Promise<{ id: string }>;
}

/**
 * Folder view — shows active items scoped to this folder.
 */
export default async function FolderPage({ params }: FolderPageProperties) {
  const { id } = await params;

  const [folder, tree, folders] = await Promise.all([
    getFolder(id),
    getFolderItems(id),
    getFolders(),
  ]);

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

      <TaskList nodes={tree} folders={folders} emptyMessage={`No tasks in ${folder.name}`} />
    </>
  );
}
