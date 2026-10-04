'use client';

import * as React from 'react';

/**
 * Debounce a callback (trailing edge): rapid repeated calls collapse into a single invocation,
 * `delayMs` after the LAST call, using that last call's args. Reading `callback` off a ref (kept
 * fresh every render) means a stale closure is never the one that fires. Any call still pending
 * on unmount is cancelled rather than firing against an unmounted caller — unless
 * `flushOnUnmount` is set, for a sync the user's action already showed on screen (a priority
 * nudge), where dropping the pending call would strand that change locally: it then runs at once.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
  { flushOnUnmount = false }: { flushOnUnmount?: boolean } = {},
): (...args: Args) => void {
  // Kept fresh via an effect, not a render-body write, so the pending timeout always fires the
  // latest closure without needing to be a `useCallback` dep (mirrors the stores' `*Ref` pattern).
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const flushOnUnmountRef = React.useRef(flushOnUnmount);
  React.useEffect(() => {
    flushOnUnmountRef.current = flushOnUnmount;
  }, [flushOnUnmount]);

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending call's args, so an unmount flush can replay them.
  const pendingArgsRef = React.useRef<Args | null>(null);

  React.useEffect(
    () => () => {
      if (timeoutRef.current === null) return;
      globalThis.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      const args = pendingArgsRef.current;
      pendingArgsRef.current = null;
      if (flushOnUnmountRef.current && args !== null) callbackRef.current(...args);
    },
    [],
  );

  return React.useCallback(
    (...args: Args) => {
      if (timeoutRef.current !== null) globalThis.clearTimeout(timeoutRef.current);
      pendingArgsRef.current = args;
      timeoutRef.current = globalThis.setTimeout(() => {
        timeoutRef.current = null;
        pendingArgsRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
