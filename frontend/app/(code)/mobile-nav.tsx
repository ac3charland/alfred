'use client';

import { Menu } from 'lucide-react';
import { Dialog } from 'radix-ui';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { ProjectNav } from '@/components/code/project-nav';
import { ViewSwitcher } from '@/components/shell/view-switcher';
import { cn } from '@/lib/utils';

/**
 * Mobile hamburger nav for the Code module — a Dialog-based slide-in drawer for narrow
 * viewports, mirroring the tasks drawer. Carries the Tasks ⇄ Code switcher above the
 * ProjectNav; both close the sheet on navigate.
 */
export default function CodeMobileNavClient() {
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
            <ProjectNav
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
