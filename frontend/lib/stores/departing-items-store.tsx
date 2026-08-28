'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

/**
 * Departing-items store — the cross-row state for rows leaving a list *together*.
 *
 * A bulk action (Dispatch) removes several rows at once, and the store mutation that removes
 * them unmounts every one of them in the same commit — there is nothing left to animate. The
 * animate-then-commit fix (see the `motion` skill) inverts that order, but the trigger (the
 * bulk bar) and the thing that animates (each TaskRow) are in different subtrees, so the
 * "these rows are on their way out" flag can't live in either: it lives here, mirroring
 * InboxSelectionProvider — mounted once in the shell, seeded with no server data, split into
 * state + actions contexts.
 *
 * The lifecycle is timer-driven rather than `transitionend`-driven (the store-modeled exit the
 * toast queue uses): with N rows leaving at once there is no single animation end to wait on,
 * and a timer degrades cleanly under reduced motion — where `depart` flags nothing at all and
 * resolves immediately, so the caller commits with no animation to strand.
 */

/**
 * How long a departure runs before the rows may unmount: the `send-off` slide (300ms) plus the
 * height collapse that trails it by 200ms (see `collapseClass`), so the gap has finished
 * closing when the mutation commits.
 */
export const DEPARTURE_MS = 500;

export interface DepartingItemsState {
  /** The ids of the rows currently playing their exit. */
  departingIds: ReadonlySet<string>;
}

interface DepartingItemsActions {
  /**
   * Flag `ids` as departing and resolve once their exit has played — `await` it, then commit
   * the mutation that actually removes them. Resolves immediately (flagging nothing) when
   * there is nothing to send off or motion is disabled.
   */
  depart: (ids: readonly string[]) => Promise<void>;
  /** Drop every flag — call it once the mutation has settled (a rollback restores its row). */
  clear: () => void;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  DepartingItemsState,
  DepartingItemsActions
>('a DepartingItemsProvider');

/** The empty set, shared so clearing an already-empty departure keeps a stable reference. */
const EMPTY: ReadonlySet<string> = new Set();

export function DepartingItemsProvider({ children }: { children: React.ReactNode }) {
  const [departingIds, setDepartingIds] = React.useState<ReadonlySet<string>>(EMPTY);
  const prefersReducedMotion = usePrefersReducedMotion();
  // Pending exit timers, so unmounting the provider mid-departure doesn't leave one firing.
  const timersRef = React.useRef<Set<ReturnType<typeof setTimeout>>>(undefined);

  React.useEffect(
    () => () => {
      for (const timer of timersRef.current ?? []) clearTimeout(timer);
      timersRef.current?.clear();
    },
    [],
  );

  const state = React.useMemo<DepartingItemsState>(() => ({ departingIds }), [departingIds]);

  const actions = React.useMemo<DepartingItemsActions>(
    () => ({
      depart(ids) {
        if (ids.length === 0 || prefersReducedMotion) return Promise.resolve();
        // One departure at a time: a bulk action owns the whole selection, so a new one
        // supersedes whatever was leaving rather than merging with it.
        setDepartingIds(new Set(ids));
        return new Promise<void>((resolve) => {
          const timers = (timersRef.current ??= new Set<ReturnType<typeof setTimeout>>());
          const timer = setTimeout(() => {
            timers.delete(timer);
            resolve();
          }, DEPARTURE_MS);
          timers.add(timer);
        });
      },
      clear() {
        setDepartingIds((current) => (current.size === 0 ? current : EMPTY));
      },
    }),
    [prefersReducedMotion],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Read which rows are playing their exit. Throws outside a provider. */
export function useDepartingItems(): DepartingItemsState {
  return useStateValue('useDepartingItems');
}

/** Read the departure actions. Throws outside a provider. */
export function useDepartingItemsActions(): DepartingItemsActions {
  return useActions('useDepartingItemsActions');
}
