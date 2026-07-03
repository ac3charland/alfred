import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { CommandPalette } from '@/components/shell/command-palette';
import { SearchBox } from '@/components/shell/search-box';
import { ShellMobileNav } from '@/components/shell/shell-mobile-nav';
import { ShellNav } from '@/components/shell/shell-nav';
import { ToastViewport } from '@/components/shell/toast-viewport';
import { ViewSwitcher } from '@/components/shell/view-switcher';
import { AlfredLink } from '@/components/tasks/alfred-link';
import { signOut } from '@/lib/auth/actions';

import { shellRootClass } from './app-shell.styles';

/**
 * Shared application shell (Server Component) mounted once by the `(shell)` layout that
 * seeds every module's providers. It owns the chrome that's identical across modules: the
 * `alfred` wordmark (links to `/` capture, unchanged), the Tasks ⇄ Code switcher, the
 * sign-out form, and the desktop sidebar / mobile header frame.
 *
 * `ToastProvider` is mounted by the `(shell)` layout (it must wrap `CodeProvider`), so this
 * shell only renders the `ToastViewport` — both live under that provider.
 *
 * The module-specific nav is no longer a prop: with one shared layout it must follow the URL
 * client-side, so the sidebar mounts `ShellNav` (FolderNav vs ProjectNav) and the header
 * mounts `ShellMobileNav` (the hamburger drawer), each deriving the active module itself.
 *
 * The switcher sits beneath the wordmark in the desktop sidebar's top-left square; on
 * mobile it moves into the hamburger, so the header bar there is just hamburger + wordmark.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className={shellRootClass}>
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
          <div className="flex-1 overflow-y-auto px-2">
            <ShellNav />
          </div>
          {/* A quiet ⌘K affordance so the navigation palette is discoverable without a mouse. */}
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground/70">
            <span className="inline-flex items-center gap-1.5">
              Press
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⌘K
              </kbd>
              to go anywhere
            </span>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header */}
          <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
            {/* Mobile: hamburger + wordmark (the switcher lives inside the hamburger) */}
            <div className="flex items-center gap-3 md:hidden">
              <ShellMobileNav />
              <AlfredLink
                aria-label="alfred — back to capture"
                className="font-serif text-xl text-foreground transition-colors duration-150 hover:text-accent-teal motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
              >
                alfred
              </AlfredLink>
            </div>

            {/* Desktop: the global search field (wordmark + switcher live in the sidebar) */}
            <div className="hidden flex-1 justify-center px-4 md:flex">
              <SearchBox placement="desktop" className="w-full max-w-md" />
            </div>

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
      <CommandPalette />
      <ToastViewport />
    </>
  );
}
