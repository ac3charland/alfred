import * as React from 'react';

import { InboxScreen } from '@/components/tasks/inbox-screen';
import { createClient } from '@/lib/supabase/server';
import { buildTree } from '@/lib/tree';
import type { Folder, Item } from '@/lib/types';

interface InboxPageProperties {
  /** `?view=inbox` reveals the inbox list; absent = the bare landing (capture box only). */
  searchParams: Promise<{ view?: string }>;
}

/**
 * Landing + Inbox page — one route.
 *
 * The bare landing shows only the capture box. `?view=inbox` reveals the inbox
 * task list below it with a fade transition (see InboxScreen). Items are always
 * fetched so they're ready to fade in without a second round-trip.
 */
export default async function InboxPage({ searchParams }: InboxPageProperties) {
  const { view } = await searchParams;
  const open = view === 'inbox';

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

  return <InboxScreen open={open} nodes={tree} folders={folders} />;
}
