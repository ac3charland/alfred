import { notFound } from 'next/navigation';
import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { getFolder } from '@/lib/data/folders';
import { getFolderItems } from '@/lib/data/items';
import { TasksProvider } from '@/lib/stores/tasks-store';

interface FolderPageProperties {
  params: Promise<{ id: string }>;
}

/**
 * Folder view — shows active items scoped to this folder.
 */
export default async function FolderPage({ params }: FolderPageProperties) {
  const { id } = await params;

  const [folder, tree] = await Promise.all([getFolder(id), getFolderItems(id)]);

  if (!folder) {
    notFound();
  }

  // `key={id}` remounts the provider when navigating folder→folder (same segment),
  // re-seeding with the new folder's tree.
  return (
    <TasksProvider key={id} initialTasks={tree}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          {folder.name}
        </span>
      </div>

      <TaskList emptyMessage={`No tasks in ${folder.name}`} />
    </TasksProvider>
  );
}
