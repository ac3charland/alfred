'use client';

import { Dialog } from 'radix-ui';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CascadeModalProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  subtaskCount: number;
  onConfirm: () => void;
  isPending: boolean;
}

/**
 * Confirmation modal shown before completing a task that has subtasks.
 * Completing cascades completion to all descendants — this makes that explicit.
 */
export function CascadeModal({
  open,
  onOpenChange,
  taskTitle,
  subtaskCount,
  onConfirm,
  isPending,
}: CascadeModalProperties) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-md rounded-2xl border border-border bg-surface p-6',
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'motion-reduce:animate-none',
          )}
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            Complete with subtasks?
          </Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">&ldquo;{taskTitle}&rdquo;</span> has{' '}
            {subtaskCount} subtask{subtaskCount === 1 ? '' : 's'} that will also be marked complete.
            This cannot be undone from this view.
          </Dialog.Description>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onConfirm}
              disabled={isPending}
              className="bg-accent-teal text-background hover:bg-accent-teal/90"
            >
              {isPending ? 'Completing…' : 'Complete all'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
