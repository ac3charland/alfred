'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@/components/atoms/dialog';
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
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className={cn(
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'w-full max-w-md rounded-2xl border border-border bg-surface p-6',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'motion-reduce:animate-none',
          )}
        >
          <DialogTitle className="text-base font-semibold text-foreground">
            Complete with subtasks?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">&ldquo;{taskTitle}&rdquo;</span> has{' '}
            {subtaskCount} subtask{subtaskCount === 1 ? '' : 's'} that will also be marked complete.
            This cannot be undone from this view.
          </DialogDescription>

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
            <Button variant="accent" size="sm" onClick={onConfirm} disabled={isPending}>
              {isPending ? 'Completing…' : 'Complete all'}
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
