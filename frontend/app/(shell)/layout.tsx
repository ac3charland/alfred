import * as React from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { TaskDndProvider } from '@/components/tasks/task-dnd-provider';
import { requireUser } from '@/lib/auth/require-user';
import { getCodeStories, getEpics, getProjects } from '@/lib/data/code';
import { getFolders } from '@/lib/data/folders';
import { getAllItems } from '@/lib/data/items';
import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { CodeProvider } from '@/lib/stores/code-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
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
  // Real auth gate — redirects to /login if no session.
  await requireUser();

  const [folders, items, projects, epics, stories] = await Promise.all([
    getFolders(),
    getAllItems(),
    getProjects(),
    getEpics(),
    getCodeStories(),
  ]);

  return (
    <FoldersProvider initialFolders={folders}>
      <TasksProvider initialTasks={items}>
        <TaskDndProvider>
          <ActiveEditorProvider>
            <ExpansionProvider>
              <ToastProvider>
                <CodeProvider
                  initialProjects={projects}
                  initialEpics={epics}
                  initialStories={stories}
                >
                  <SearchProvider>
                    <AppShell>{children}</AppShell>
                  </SearchProvider>
                </CodeProvider>
              </ToastProvider>
            </ExpansionProvider>
          </ActiveEditorProvider>
        </TaskDndProvider>
      </TasksProvider>
    </FoldersProvider>
  );
}
