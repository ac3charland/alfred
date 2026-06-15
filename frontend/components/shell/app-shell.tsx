import * as React from 'react';

import { ViewSwitcher } from '@/components/shell/view-switcher';
import { AlfredLink } from '@/components/tasks/alfred-link';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';

/**
 * Shared application shell (Server Component) used by BOTH module layouts — `(tasks)` and
 * `(code)` (§6). It owns the chrome that's identical across modules: the `alfred` wordmark
 * (links to `/` capture, unchanged), the Tasks ⇄ Code switcher, the sign-out form, and the
 * desktop sidebar / mobile header frame. Each layout passes in the module-appropriate
 * `nav` (desktop sidebar) and `mobileNav` (the hamburger drawer, which carries the switcher
 * on small screens, §6.3) and seeds its own providers around `<AppShell>`.
 *
 * The switcher sits beneath the wordmark in the desktop sidebar's top-left square; on
 * mobile it moves into the hamburger, so the header bar there is just hamburger + wordmark.
 */
export function AppShell({
  nav,
  mobileNav,
  children,
}: {
  /** The module's desktop sidebar navigation (FolderNav / ProjectNav). */
  nav: React.ReactNode;
  /** The mobile hamburger drawer (carries the switcher + nav on small screens). */
  mobileNav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col border-r border-border bg-surface">
        <div className="flex flex-col gap-3 px-4 py-3 border-b border-border">
          <AlfredLink
            aria-label="alfred — back to capture"
            className="font-serif text-xl text-foreground tracking-tight transition-colors duration-150 hover:text-accent-teal motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
          >
            alfred
          </AlfredLink>
          <ViewSwitcher />
        </div>
        <div className="flex-1 overflow-y-auto px-2">{nav}</div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          {/* Mobile: hamburger + wordmark (the switcher lives inside the hamburger) */}
          <div className="flex items-center gap-3 md:hidden">
            {mobileNav}
            <AlfredLink
              aria-label="alfred — back to capture"
              className="font-serif text-xl text-foreground transition-colors duration-150 hover:text-accent-teal motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
            >
              alfred
            </AlfredLink>
          </div>

          {/* Desktop: spacer (wordmark + switcher live in the sidebar) */}
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
        <main className="flex-1 overflow-y-auto flex flex-col">{children}</main>
      </div>
    </div>
  );
}
