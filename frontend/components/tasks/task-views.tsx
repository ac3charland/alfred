'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { CompletedView } from '@/components/tasks/completed-view';
import { FolderView } from '@/components/tasks/folder-view';
import { InboxScreen } from '@/components/tasks/inbox-screen';

const FOLDER_PREFIX = '/folders/';

/**
 * Client-side view router for the tasks module.
 *
 * Every page in the module (the inbox `/`, `/folders/[id]`, `/completed`) renders this
 * one component, which derives the active view purely from the URL and renders it from
 * the already-seeded stores. The nav links switch the URL via the History API (see
 * ViewLink) rather than an RSC navigation, so this re-renders the new view with no
 * server round-trip; a hard load of any of those paths renders the same view server-side.
 */
export function TaskViews() {
  const pathname = usePathname();
  const searchParameters = useSearchParams();

  if (pathname === '/completed') {
    return <CompletedView />;
  }

  if (pathname.startsWith(FOLDER_PREFIX)) {
    return <FolderView folderId={pathname.slice(FOLDER_PREFIX.length)} />;
  }

  // Landing / inbox at `/` — the list is revealed by `?view=inbox`.
  return <InboxScreen open={searchParameters.get('view') === 'inbox'} />;
}
