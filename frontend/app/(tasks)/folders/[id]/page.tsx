import { notFound } from 'next/navigation';
import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { createClient } from '@/lib/supabase/server';
import { buildTree } from '@/lib/tree';
import type { Folder, Item } from '@/lib/types';

interface FolderPageProperties {
  params: Promise<{ id: string }>;
}

/**
 * Folder view — shows active items scoped to this folder.
 */
export default async function FolderPage({ params }: FolderPageProperties) {
  const { id } = await params;
  const supabase = await createClient();

  const [folderResult, itemsResult, foldersResult] = await Promise.all([
    supabase.from('folders').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('items')
      .select('*')
      .eq('folder_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    supabase.from('folders').select('*').order('created_at', { ascending: true }),
  ]);

  if (!folderResult.data) {
    notFound();
  }

  const folder: Folder = folderResult.data;
  const items: Item[] = itemsResult.data ?? [];
  const folders: Folder[] = foldersResult.data ?? [];

  const tree = buildTree(items);

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
