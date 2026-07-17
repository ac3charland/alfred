import * as React from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { TaskDndProvider } from '@/components/tasks/task-dnd-provider';
import { requireUser } from '@/lib/auth/require-user';
import { getCodeStories, getEpics, getProjects } from '@/lib/data/code';
import { getFolders } from '@/lib/data/folders';
import { getAllItems } from '@/lib/data/items';
import { getInstanceConfig } from '@/lib/instance';
import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { CodeFilterProvider } from '@/lib/stores/code-filter-store';
import { CodeProvider } from '@/lib/stores/code-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { InboxSelectionProvider } from '@/lib/stores/inbox-selection-store';
import { SearchProvider } from '@/lib/stores/search-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import { ToastProvider } from '@/lib/stores/toast-store';

/**
 * Shared shell layout (Server Component) — the single parent of BOTH modules' route groups
 * (`(tasks)` and `(code)`), introduced by ALF-27 so switching modules is a client-side URL
 * change with no SSR / RSC round-trip.
 *
 * It absorbs everything the two old per-module layouts duplicated:
 * - `requireUser()` — the single auth gate (middleware is defense-in-depth only). An
 *   unauthenticated visit to ANY module path redirects to /login here.
 * - Fetches every module's data in parallel and seeds every provider once, nesting the
 *   existing trees. At MVP scale (hundreds of rows) the eager fetch of the other module's
 *   data is the accepted "fetch-all, seed-once" tradeoff (see the data-flow skill); a lazy
 *   per-module client fetch is the deferred future revisit.
 *
 * Every page under here renders the shared `ModuleRouter`, so a `pushState` between modules
 * just re-derives the view from the URL — the providers never unmount, so optimistic state
 * in both modules survives a switch.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Real auth gate — redirects to /login if no session. The user (its email) feeds the
  // instance menu header, so keep the return rather than discarding it.
  const user = await requireUser();

  const [folders, items, projects, epics, stories] = await Promise.all([
    getFolders(),
    getAllItems(),
    getProjects(),
    getEpics(),
    getCodeStories(),
  ]);

  return (
    // ToastProvider is the OUTERMOST provider so all three optimistic stores
    // (Folders / Tasks / Code) sit inside it and can fire an error toast from their
    // rollback path via useToastActions (ALF-33). AppShell renders the ToastViewport.
    <ToastProvider>
      <FoldersProvider initialFolders={folders}>
        <TasksProvider initialTasks={items}>
          <TaskDndProvider>
            <ActiveEditorProvider>
              <ExpansionProvider>
                <InboxSelectionProvider>
                  <CodeProvider
                    initialProjects={projects}
                    initialEpics={epics}
                    initialStories={stories}
                  >
                    <CodeFilterProvider>
                      <SearchProvider>
                        <AppShell email={user.email ?? null} instance={getInstanceConfig()}>
                          {children}
                        </AppShell>
                      </SearchProvider>
                    </CodeFilterProvider>
                  </CodeProvider>
                </InboxSelectionProvider>
              </ExpansionProvider>
            </ActiveEditorProvider>
          </TaskDndProvider>
        </TasksProvider>
      </FoldersProvider>
    </ToastProvider>
  );
}
