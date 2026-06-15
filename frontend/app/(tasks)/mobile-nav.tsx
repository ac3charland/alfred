'use client';

import { Menu } from 'lucide-react';
import { Dialog } from 'radix-ui';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { ViewSwitcher } from '@/components/shell/view-switcher';
import { FolderNav } from '@/components/tasks/folder-nav';
import { cn } from '@/lib/utils';

/**
 * Mobile hamburger nav — a Dialog-based slide-in drawer for narrow viewports.
 * Carries the Tasks ⇄ Code switcher (§6.3 — the switcher lives inside the hamburger on
 * small screens, not the header bar) above the FolderNav. The FolderNav reads folders from
 * the store and closes the sheet when a link is clicked (via onClose); the switcher closes
 * it on navigate too.
 */
export default function MobileNavClient() {
  const [open, setOpen] = React.useState(false);

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
            <ViewSwitcher
              onNavigate={() => {
                setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto px-2">
            <FolderNav
              onClose={() => {
                setOpen(false);
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
