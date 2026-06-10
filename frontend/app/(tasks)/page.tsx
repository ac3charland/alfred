import * as React from 'react';

import { InboxScreen } from '@/components/tasks/inbox-screen';
import { getFolders } from '@/lib/data/folders';
import { getInboxTree } from '@/lib/data/items';

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

  const [tree, folders] = await Promise.all([getInboxTree(), getFolders()]);

  return <InboxScreen open={open} nodes={tree} folders={folders} />;
}
