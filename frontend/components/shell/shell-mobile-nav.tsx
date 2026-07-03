'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from '@/components/atoms/dialog';
import { IconButton } from '@/components/atoms/icon-button';
import { ProjectNav } from '@/components/code/project-nav';
import { SearchBox } from '@/components/shell/search-box';
import { ViewSwitcher } from '@/components/shell/view-switcher';
import { FolderNav } from '@/components/tasks/folder-nav';
import { isCodePath } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The shell's mobile hamburger nav — a Dialog-based slide-in drawer for narrow viewports.
 * Replaces the two per-module mobile-nav files: it carries the Tasks ⇄ Code switcher (the
 * switcher lives inside the hamburger on small screens) above the module's nav, which it
 * picks from the URL (`isCodePath`) — `ProjectNav` for Code, `FolderNav` for Tasks. Both the
 * switcher and the nav close the sheet on navigate.
 */
export function ShellMobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const close = () => {
    setOpen(false);
  };

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton size="lg" aria-label="Open navigation">
          <Menu size={18} />
        </IconButton>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          // Keep focus on the trigger when the drawer opens: Radix otherwise auto-focuses the
          // first focusable child — the search field — which pops the mobile keyboard and (via
          // its onFocus) opens the results dropdown every time the drawer is opened.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          className={cn(
            'fixed left-0 top-0 bottom-0 z-50 w-64 bg-surface border-r border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
            'duration-200 motion-reduce:animate-none',
          )}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex flex-col gap-3 px-4 py-3 border-b border-border">
            <span className="font-serif text-xl text-foreground">alfred</span>
            <ViewSwitcher onNavigate={close} />
            {/* The header bar is tight on mobile, so the search field is surfaced here. */}
            <SearchBox placement="mobile" className="w-full" onNavigate={close} />
          </div>
          <div className="overflow-y-auto px-2">
            {isCodePath(pathname) ? <ProjectNav onClose={close} /> : <FolderNav onClose={close} />}
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
