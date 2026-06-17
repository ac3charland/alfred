import * as React from 'react';

import MobileNavClient from '@/app/(tasks)/mobile-nav';
import { AppShell } from '@/components/shell/app-shell';
import { FolderNav } from '@/components/tasks/folder-nav';
import { TaskDndProvider } from '@/components/tasks/task-dnd-provider';
import { requireUser } from '@/lib/auth/require-user';
import { getFolders } from '@/lib/data/folders';
import { getAllItems } from '@/lib/data/items';
import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { TasksProvider } from '@/lib/stores/tasks-store';

/**
 * Tasks module layout (Server Component).
 *
 * - Calls requireUser() as the real auth gate (middleware is defense-in-depth only).
 * - Fetches folders + ALL items once and seeds both stores for the whole module; pages
 *   filter the item list client-side per view (see the data-flow skill).
 * - Renders the shared AppShell (wordmark + Tasks⇄Code switcher + sign-out) with the
 *   tasks-module nav: FolderNav on desktop, the hamburger drawer on mobile.
 */
export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  // Real auth gate — redirects to /login if no session
  await requireUser();

  const [folders, items] = await Promise.all([getFolders(), getAllItems()]);

  return (
    <FoldersProvider initialFolders={folders}>
      <TasksProvider initialTasks={items}>
        <TaskDndProvider>
          <ActiveEditorProvider>
            <ExpansionProvider>
              <AppShell nav={<FolderNav />} mobileNav={<MobileNavClient />}>
                <div className="mx-auto w-full max-w-3xl px-4 py-8 flex-1 flex flex-col">
                  {children}
                </div>
              </AppShell>
            </ExpansionProvider>
          </ActiveEditorProvider>
        </TaskDndProvider>
      </TasksProvider>
    </FoldersProvider>
  );
}
