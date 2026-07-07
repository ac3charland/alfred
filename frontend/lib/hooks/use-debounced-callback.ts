'use client';

import * as React from 'react';

/**
 * Debounce a callback (trailing edge): rapid repeated calls collapse into a single invocation,
 * `delayMs` after the LAST call, using that last call's args. Reading `callback` off a ref (kept
 * fresh every render) means a stale closure is never the one that fires. Any call still pending
 * on unmount is cancelled rather than firing against an unmounted caller.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  // Kept fresh via an effect, not a render-body write, so the pending timeout always fires the
  // latest closure without needing to be a `useCallback` dep (mirrors the stores' `*Ref` pattern).
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== null) globalThis.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return React.useCallback(
    (...args: Args) => {
      if (timeoutRef.current !== null) globalThis.clearTimeout(timeoutRef.current);
      timeoutRef.current = globalThis.setTimeout(() => {
        timeoutRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
