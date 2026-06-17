'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Dialog } from 'radix-ui';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { ProjectNav } from '@/components/code/project-nav';
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <IconButton size="lg" aria-label="Open navigation">
          <Menu size={18} />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed left-0 top-0 bottom-0 z-50 w-64 bg-surface border-r border-border',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
            'duration-200 motion-reduce:animate-none',
          )}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex flex-col gap-3 px-4 py-3 border-b border-border">
            <span className="font-serif text-xl text-foreground">alfred</span>
            <ViewSwitcher onNavigate={close} />
          </div>
          <div className="overflow-y-auto px-2">
            {isCodePath(pathname) ? <ProjectNav onClose={close} /> : <FolderNav onClose={close} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
