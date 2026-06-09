import * as React from 'react';

import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskList } from '@/components/tasks/task-list';
import { createClient } from '@/lib/supabase/server';
import { buildTree } from '@/lib/tree';
import type { Folder, Item } from '@/lib/types';

/**
 * Inbox page — default view.
 *
 * Fetches active inbox items (folder_id = null, status = active) and all folders
 * server-side. Passes them to client components for interactive rendering.
 */
export default async function InboxPage() {
  const supabase = await createClient();

  const [itemsResult, foldersResult] = await Promise.all([
    supabase
      .from('items')
      .select('*')
      .is('folder_id', null)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    supabase.from('folders').select('*').order('created_at', { ascending: true }),
  ]);

  const items: Item[] = itemsResult.data ?? [];
  const folders: Folder[] = foldersResult.data ?? [];

  const tree = buildTree(items);

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Inbox
        </span>
      </div>

      {/* Capture box — the hero */}
      <div className="mb-8">
        <CaptureBox />
      </div>

      {/* Task list */}
      <TaskList nodes={tree} folders={folders} emptyMessage="Your inbox is empty" />
    </>
  );
}
