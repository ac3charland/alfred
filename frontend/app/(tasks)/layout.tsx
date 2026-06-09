import * as React from 'react';

import MobileNavClient from '@/app/(tasks)/mobile-nav';
import { FolderNav } from '@/components/tasks/folder-nav';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';
import { requireUser } from '@/lib/auth/require-user';
import { createClient } from '@/lib/supabase/server';
import type { Folder } from '@/lib/types';

/**
 * Tasks module layout (Server Component).
 *
 * - Calls requireUser() as the real auth gate (middleware is defense-in-depth only).
 * - Fetches folders server-side for the sidebar.
 * - Renders a persistent desktop sidebar + responsive mobile nav.
 */
export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  // Real auth gate — redirects to /login if no session
  await requireUser();

  const supabase = await createClient();
  const { data: folders } = await supabase
    .from('folders')
    .select('*')
    .order('created_at', { ascending: true });

  const resolvedFolders: Folder[] = folders ?? [];

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center px-4 border-b border-border">
          <span className="font-serif text-xl text-foreground tracking-tight">alfred</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <FolderNav folders={resolvedFolders} />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          {/* Mobile: hamburger + wordmark */}
          <div className="flex items-center gap-3 md:hidden">
            <MobileNavClient folders={resolvedFolders} />
            <span className="font-serif text-xl text-foreground">alfred</span>
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
  );
}
