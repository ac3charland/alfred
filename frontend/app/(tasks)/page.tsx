import * as React from 'react';

import { InboxScreen } from '@/components/tasks/inbox-screen';

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

  // Items come from the layout-level TasksProvider; the inbox view filters them client-side.
  return <InboxScreen open={open} />;
}
