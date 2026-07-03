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
 *
 * Auto-dismiss is **visibility-gated**: a toast's DISMISS_MS countdown only runs while the tab
 * is active (`!document.hidden`). A toast fired into a backgrounded tab is parked untouched;
 * a running countdown is cancelled and re-parked if the tab loses focus. Each time the tab
 * regains focus (`visibilitychange` / window `focus`, mirroring the code store), every parked
 * toast gets a fresh countdown — so the user never returns to a toast that expired unseen.
 */

export type ToastVariant = 'default' | 'emphasis';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /**
   * Optional client-side nav target. When set, the viewport renders the toast body as a link
   * (see `ToastItem`) so a click jumps there — e.g. a "Created ALF-42" toast deep-links to the
   * new story's board modal (`/code/<projectId>?story=<ref>`) and dismisses itself.
   */
  href?: string;
  /** Marked true once dismissal starts, so the viewport plays the exit before removal. */
  leaving: boolean;
}

interface ToastActions {
  /**
   * Enqueue a transient toast; it auto-dismisses after a few seconds. `variant` defaults to
   * `'default'`; pass `'emphasis'` for the louder, chime-playing treatment. Pass `href` to make
   * the toast body a link (a client-side nav that dismisses on click — see `ToastItem`).
   */
  showToast: (message: string, variant?: ToastVariant, href?: string) => void;
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

  // Auto-dismiss bookkeeping (see the visibility-gated note above). `pendingIds` holds toasts
  // waiting to (re)start their countdown — shown while backgrounded, or parked when the tab
  // lost focus. `dismissTimers` holds the live DISMISS_MS handles so a countdown can be
  // cancelled when the tab goes hidden. Both live in refs: they're mutated from timers and
  // event handlers, and changing them must not trigger a re-render.
  const pendingIds = React.useRef<Set<string>>(new Set());
  const dismissTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Two-phase dismissal: mark `leaving` so the exit animation can play, then remove after
  // EXIT_MS. Idempotent — re-marking an already-leaving toast is a no-op, and the delayed
  // filter harmlessly no-ops on an id that's already gone.
  const beginDismiss = React.useCallback((id: string) => {
    pendingIds.current.delete(id);
    const handle = dismissTimers.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      dismissTimers.current.delete(id);
    }
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
    );
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, EXIT_MS);
  }, []);

  // Start (or restart) one toast's DISMISS_MS countdown. Called when a toast is shown into an
  // active tab, and for every parked toast when the tab regains focus. Clears any prior handle
  // first so a restart never leaks a timer.
  const startDismissTimer = React.useCallback(
    (id: string) => {
      pendingIds.current.delete(id);
      const existing = dismissTimers.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      dismissTimers.current.set(
        id,
        setTimeout(() => {
          beginDismiss(id);
        }, DISMISS_MS),
      );
    },
    [beginDismiss],
  );

  // Refocus/background handling. On refocus, give every parked toast a fresh countdown; on
  // background, cancel every running countdown and re-park its toast so nothing dismisses
  // while the user is away. `focus` only ever fires on refocus, so it maps to onActive.
  React.useEffect(() => {
    const onActive = () => {
      if (document.hidden) return;
      const parked = [...pendingIds.current];
      pendingIds.current.clear();
      for (const id of parked) startDismissTimer(id);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        onActive();
        return;
      }
      for (const [id, handle] of dismissTimers.current) {
        clearTimeout(handle);
        pendingIds.current.add(id);
      }
      dismissTimers.current.clear();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onActive);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onActive);
    };
  }, [startDismissTimer]);

  const actions = React.useMemo<ToastActions>(
    () => ({
      showToast(message, variant = 'default', href) {
        const id = crypto.randomUUID();
        // Conditionally spread `href` (never assign it `undefined`) so the optional property
        // stays absent under exactOptionalPropertyTypes when no nav target is given.
        setToasts((current) => [
          ...current,
          { id, message, variant, leaving: false, ...(href !== undefined && { href }) },
        ]);
        // Fire the chime once, from this single imperative call (not a mount effect, which
        // StrictMode would double-invoke). `matchMedia` is always-defined client-side, so the
        // reduced-motion guard reads it directly — sound stays silent when motion is reduced.
        if (variant === 'emphasis' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          playToastSound();
        }
        // Only count down while the tab is active; otherwise park the toast until it regains
        // focus (the effect above starts the countdown then).
        if (document.hidden) {
          pendingIds.current.add(id);
        } else {
          startDismissTimer(id);
        }
      },
      dismissToast(id) {
        beginDismiss(id);
      },
    }),
    [beginDismiss, startDismissTimer],
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
