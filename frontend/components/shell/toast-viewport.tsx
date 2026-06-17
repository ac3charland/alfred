'use client';

import { X } from 'lucide-react';
import * as React from 'react';

import { useToastActions, useToasts } from '@/lib/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * Renders the toast queue into a fixed, bottom-right `aria-live` region so a
 * screen reader announces each new message. Each toast is dismissable and auto-expires
 * (see the toast store). Kept tiny and styled to the dense dark UI.
 */
export function ToastViewport() {
  const toasts = useToasts();
  const { dismissToast } = useToastActions();

  return (
    <div
      // A bare aria-live region (NOT role="status") announces new toasts without
      // stealing focus. Deliberately no `role="status"`: that role is reserved for the
      // inline Spinner, and an always-present empty status region would collide with
      // `getByRole('status')` in unrelated tests. aria-live alone is the live-region cue.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-xs flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3',
            'text-sm text-foreground shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]',
            'animate-fade-in motion-reduce:animate-none',
          )}
        >
          <span className="min-w-0 break-words">{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => {
              dismissToast(toast.id);
            }}
            className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal motion-reduce:transition-none"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
