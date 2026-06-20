'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';

/**
 * Toast store — a tiny cross-cutting notification queue (the gate's "Created ALF-42"
 * confirmation). Mounted once in the shared AppShell so any module can fire a toast;
 * split into state + actions contexts like the other stores so actions-only callers
 * (`useToastActions`) don't re-render when the queue changes.
 *
 * Deliberately minimal: a transient, auto-dismissing message rendered into an `aria-live`
 * region (see `ToastViewport`). No variants, no positioning options — add them only when a
 * second use needs them.
 */

export interface Toast {
  id: string;
  message: string;
}

interface ToastActions {
  /** Enqueue a transient toast; it auto-dismisses after a few seconds. */
  showToast: (message: string) => void;
  /** Dismiss a toast early (the close button / the auto-dismiss timer). */
  dismissToast: (id: string) => void;
}

const DISMISS_MS = 4000;

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  Toast[],
  ToastActions
>('a ToastProvider');

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const actions = React.useMemo<ToastActions>(
    () => ({
      showToast(message) {
        const id = crypto.randomUUID();
        setToasts((current) => [...current, { id, message }]);
        // Auto-dismiss. A user event always precedes this, so the timer is harmless in
        // tests (fake timers can flush it) and unmount drops the closure.
        setTimeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, DISMISS_MS);
      },
      dismissToast(id) {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      },
    }),
    [],
  );

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
