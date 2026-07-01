'use client';

import { X } from 'lucide-react';
import * as React from 'react';

import { CloseButton } from '@/components/atoms/close-button';
import { ViewLink } from '@/components/tasks/view-link';
import { type Toast, useToastActions, useToasts } from '@/lib/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * A single toast card. Branches its styling on `variant` (an `emphasis` toast reads louder:
 * a glowing accent-teal border and a bigger card) and its motion on `leaving` (slide+fade
 * in on appear, slide+fade out on dismissal — both via tw-animate-css). The default branch
 * keeps the exact border/size/background it has always had so default toasts don't regress.
 *
 * When the toast carries an `href`, its message becomes a `ViewLink` (a client-side nav that
 * also dismisses the toast on click) — kept a sibling of the close button, not a wrapper, so
 * there are no nested interactive elements. A plain message stays a static `<span>`.
 */
export function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const isEmphasis = toast.variant === 'emphasis';

  return (
    <div
      data-variant={toast.variant}
      data-leaving={toast.leaving}
      className={cn(
        'pointer-events-auto flex w-full items-center justify-between gap-3 rounded-lg border text-foreground shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]',
        isEmphasis
          ? 'glow-emphasis max-w-sm border-accent-teal bg-surface px-5 py-4 text-base'
          : 'max-w-xs border-border bg-surface px-4 py-3 text-sm',
        // Timer-driven removal (EXIT_MS in the store), not animationend-driven — so
        // motion-reduce simply means the toast holds then disappears, no flash, no stranding.
        // `fill-mode-forwards` is load-bearing on the exit: tw-animate-css's `animate-out`
        // defaults to fill-mode none, so without it the toast reverts to full opacity for a
        // frame after the 200ms animation ends but before the EXIT_MS removal commits — the
        // same flash the motion skill documents for fade-out. forwards holds it hidden.
        toast.leaving
          ? 'animate-out fade-out-0 slide-out-to-bottom-2 fill-mode-forwards duration-200 motion-reduce:animate-none'
          : 'animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
      )}
    >
      {toast.href === undefined ? (
        <span className="min-w-0 break-words">{toast.message}</span>
      ) : (
        <ViewLink
          href={toast.href}
          // Dismiss as we navigate: ViewLink runs onClick before pushState, so the toast leaves
          // and the URL changes in one click. The visible message is the link's accessible name.
          onClick={onDismiss}
          className="min-w-0 break-words rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
        >
          {toast.message}
        </ViewLink>
      )}
      <CloseButton variant="icon" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={14} />
      </CloseButton>
    </div>
  );
}

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
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => {
            dismissToast(toast.id);
          }}
        />
      ))}
    </div>
  );
}
