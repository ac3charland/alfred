import * as React from 'react';

import MobileNavClient from '@/app/(tasks)/mobile-nav';
import { FolderNav } from '@/components/tasks/folder-nav';
import { TaskDndProvider } from '@/components/tasks/task-dnd-provider';
import { ViewLink } from '@/components/tasks/view-link';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';
import { requireUser } from '@/lib/auth/require-user';
import { getFolders } from '@/lib/data/folders';
import { getAllItems } from '@/lib/data/items';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { TasksProvider } from '@/lib/stores/tasks-store';

/**
 * Tasks module layout (Server Component).
 *
 * - Calls requireUser() as the real auth gate (middleware is defense-in-depth only).
 * - Fetches folders + ALL items once and seeds both stores for the whole module; pages
 *   filter the item list client-side per view (see the data-flow skill).
 * - Renders a persistent desktop sidebar + responsive mobile nav.
 */
export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  // Real auth gate — redirects to /login if no session
  await requireUser();

  const [folders, items] = await Promise.all([getFolders(), getAllItems()]);

  return (
    <FoldersProvider initialFolders={folders}>
      <TasksProvider initialTasks={items}>
        <TaskDndProvider>
          <div className="flex h-full min-h-screen bg-background">
            {/* Desktop sidebar */}
            <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col border-r border-border bg-surface">
              <div className="flex h-14 items-center px-4 border-b border-border">
                <ViewLink
                  href="/"
                  aria-label="alfred — back to capture"
                  className="font-serif text-xl text-foreground tracking-tight transition-colors duration-150 hover:text-accent-teal motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
                >
                  alfred
                </ViewLink>
              </div>
              <div className="flex-1 overflow-y-auto px-2">
                <FolderNav />
              </div>
            </aside>

            {/* Main content area */}
            <div className="flex flex-1 flex-col min-w-0">
              {/* Header */}
              <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
                {/* Mobile: hamburger + wordmark */}
                <div className="flex items-center gap-3 md:hidden">
                  <MobileNavClient />
                  <ViewLink
                    href="/"
                    aria-label="alfred — back to capture"
                    className="font-serif text-xl text-foreground transition-colors duration-150 hover:text-accent-teal motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
                  >
                    alfred
                  </ViewLink>
                </div>

                {/* Desktop: spacer (wordmark is in sidebar) */}
                <div className="hidden md:block" />

                {/* Sign out */}
                <form action={signOut}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Sign out
                  </Button>
                </form>
              </header>

              {/* Page content */}
              <main className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
              </main>
            </div>
          </div>
        </TaskDndProvider>
      </TasksProvider>
    </FoldersProvider>
  );
}
