import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ItemNode } from '@/lib/tree';
import { buildTree } from '@/lib/tree';

/**
 * Server-only read layer for items, returning the built subtask forest.
 *
 * Each reader scopes the same way the routes/pages did inline (inbox = no folder +
 * active; folder = that folder + active; completed = done) and returns a tree via
 * buildTree, ready to seed a page's TasksProvider. Client components never import
 * this — they read from the TasksProvider store and mutate via lib/api-client.
 */

/** Active, folder-less items (the Inbox), newest first, as a forest. */
export async function getInboxTree(): Promise<ItemNode[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('items')
    .select('*')
    .is('folder_id', null)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  return buildTree(data ?? []);
}

/** Active items in a given folder, newest first, as a forest. */
export async function getFolderItems(folderId: string): Promise<ItemNode[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('folder_id', folderId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  return buildTree(data ?? []);
}

/** Completed items across all folders, most recently completed first, as a forest. */
export async function getCompletedItems(): Promise<ItemNode[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });
  return buildTree(data ?? []);
}
