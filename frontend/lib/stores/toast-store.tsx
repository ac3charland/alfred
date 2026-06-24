'use client';

import * as React from 'react';

import { playToastSound } from '@/lib/play-toast-sound';
import { createContextPair } from '@/lib/stores/create-context-pair';

/**
 * Toast store — a tiny cross-cutting notification queue (the gate's "Created ALF-42"
 * confirmation, and the realtime code-move alert). Mounted once in the shared AppShell so any
 * module can fire a toast; split into state + actions contexts like the other stores so
 * actions-only callers (`useToastActions`) don't re-render when the queue changes.
 *
 * A transient, auto-dismissing message rendered into an `aria-live` region (see
 * `ToastViewport`). One `emphasis` variant exists (a louder card + a Web Audio chime, used by
 * the realtime code-move toast); everything else is `default`. Dismissal is two-phase: a toast
 * is first marked `leaving` so the viewport can animate it out, then removed after `EXIT_MS`
 * (the store-driven analogue of the motion skill's animate-then-commit pattern).
 */

export type ToastVariant = 'default' | 'emphasis';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Marked true once dismissal starts, so the viewport plays the exit before removal. */
  leaving: boolean;
}

interface ToastActions {
  /**
   * Enqueue a transient toast; it auto-dismisses after a few seconds. `variant` defaults to
   * `'default'`; pass `'emphasis'` for the louder, chime-playing treatment.
   */
  showToast: (message: string, variant?: ToastVariant) => void;
  /** Dismiss a toast early (the close button / the auto-dismiss timer). Animates out first. */
  dismissToast: (id: string) => void;
}

const DISMISS_MS = 4000;
/** Matches the viewport's exit animation duration — how long a `leaving` toast lingers. */
const EXIT_MS = 200;

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  Toast[],
  ToastActions
>('a ToastProvider');

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const actions = React.useMemo<ToastActions>(() => {
    // Two-phase dismissal: mark `leaving` so the exit animation can play, then remove after
    // EXIT_MS. Idempotent — re-marking an already-leaving toast is a no-op, and the delayed
    // filter harmlessly no-ops on an id that's already gone.
    const beginDismiss = (id: string) => {
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, EXIT_MS);
    };

    return {
      showToast(message, variant = 'default') {
        const id = crypto.randomUUID();
        setToasts((current) => [...current, { id, message, variant, leaving: false }]);
        // Fire the chime once, from this single imperative call (not a mount effect, which
        // StrictMode would double-invoke). `matchMedia` is always-defined client-side, so the
        // reduced-motion guard reads it directly — sound stays silent when motion is reduced.
        if (variant === 'emphasis' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          playToastSound();
        }
        // Auto-dismiss through the same animate-out path. A user event always precedes this,
        // so the timer is harmless in tests (fake timers can flush it) and unmount drops it.
        setTimeout(() => {
          beginDismiss(id);
        }, DISMISS_MS);
      },
      dismissToast(id) {
        beginDismiss(id);
      },
    };
  }, []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={toasts}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Read the current toast queue (the viewport). Throws outside a ToastProvider. */
export function useToasts(): Toast[] {
  return useStateValue('useToasts');
}

/** Read the toast actions (`showToast` / `dismissToast`). Throws outside a ToastProvider. */
export function useToastActions(): ToastActions {
  return useActions('useToastActions');
}
