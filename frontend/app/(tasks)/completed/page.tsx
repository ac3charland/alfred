import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { createClient } from '@/lib/supabase/server';
import { buildTree } from '@/lib/tree';
import type { Folder, Item } from '@/lib/types';

/**
 * Completed view — shows all completed tasks across inbox and folders.
 * Read-only: no capture box here (completed tasks are done).
 */
export default async function CompletedPage() {
  const supabase = await createClient();

  const [itemsResult, foldersResult] = await Promise.all([
    supabase
      .from('items')
      .select('*')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false }),
    supabase.from('folders').select('*').order('created_at', { ascending: true }),
  ]);

  const items: Item[] = itemsResult.data ?? [];
  const folders: Folder[] = foldersResult.data ?? [];

  const tree = buildTree(items);

  // Collect IDs of active parents for root-level completed items whose parent wasn't completed
  const completedIds = new Set(items.map((i) => i.id));
  const orphanParentIds: string[] = [];
  for (const node of tree) {
    if (node.parent_id !== null && !completedIds.has(node.parent_id)) {
      orphanParentIds.push(node.parent_id);
    }
  }

  let parentTitleMap: Map<string, string> | undefined;
  if (orphanParentIds.length > 0) {
    const parentsResult = await supabase
      .from('items')
      .select('id, title')
      .in('id', orphanParentIds);
    if (parentsResult.data) {
      parentTitleMap = new Map(parentsResult.data.map((p) => [p.id, p.title]));
    }
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Completed
        </span>
      </div>

      <div className="mb-8">
        <p className="text-sm text-muted-foreground">
          {items.length} completed task{items.length === 1 ? '' : 's'}
        </p>
      </div>

      <TaskList
        nodes={tree}
        folders={folders}
        emptyMessage="Nothing completed yet"
        isCompleted
        {...(parentTitleMap !== undefined && { parentTitleMap })}
      />
    </>
  );
}
