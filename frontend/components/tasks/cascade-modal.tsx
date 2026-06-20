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

import { cascadeContentClass } from './cascade-modal.styles';

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
        <DialogContent className={cascadeContentClass}>
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
