'use client';

import * as React from 'react';

/** A multi-select filter held under one view key — see {@link useKeyedFilter}. */
export interface KeyedFilter<TValue> {
  /** The currently-selected values (a subset of the caller's option list). */
  selected: readonly TValue[];
  /**
   * Replace the whole selection at once — jump to an exact set rather than toggling one value at
   * a time (the counterpart to `toggle`).
   */
  setSelected: React.Dispatch<React.SetStateAction<readonly TValue[]>>;
  /** Toggle one value in or out of the selection. */
  toggle: (value: TValue) => void;
  /**
   * Whether the selection differs from its resting default — drives the trigger's teal + count
   * treatment. `false` at the default (narrower OR wider), `true` for any other selection.
   */
  isFiltering: boolean;
}

/**
 * The mechanics behind every "Filter by X" multi-select: read the stored selection (falling back
 * to `defaults` while a view is untouched), toggle one value, and report whether the selection
 * has moved off its default. Storage is the caller's — it passes the value it read out of the
 * `CodeFilterProvider` and a `store` callback that writes back under its own key — so the same
 * logic serves the status filter and the Backlog's project filter without either owning it.
 *
 * `defaults` must be **referentially stable** (a module constant or a memo) so the returned
 * `selected` stays stable while untouched, and downstream selector memos don't rerun every render.
 */
export function useKeyedFilter<TValue>(
  stored: readonly TValue[] | undefined,
  store: React.Dispatch<React.SetStateAction<readonly TValue[]>>,
  defaults: readonly TValue[],
): KeyedFilter<TValue> {
  const selected = stored ?? defaults;

  const toggle = React.useCallback(
    (value: TValue) => {
      store((current) =>
        current.includes(value)
          ? current.filter((candidate) => candidate !== value)
          : [...current, value],
      );
    },
    [store],
  );

  // Flag the trigger only when the selection differs from the default. The default is the resting
  // state (neither narrower nor wider), so compare length AND membership: any add or drop flips it.
  const isFiltering =
    selected.length !== defaults.length || !defaults.every((value) => selected.includes(value));

  return { selected, setSelected: store, toggle, isFiltering };
}
