'use client';

import * as React from 'react';

import {
  CheckboxFilterItems,
  CheckboxFilterMenu,
  type FilterOption,
} from '@/components/atoms/checkbox-filter-menu';
import { FACTORY_STATE_LABELS } from '@/lib/stores/code-store';
import type { CodeFactoryState } from '@/lib/types';

export interface StatusFilterItemsProperties {
  /** The factory states offered as checkboxes, in display order. */
  options: readonly CodeFactoryState[];
  /** The currently-selected states. */
  selected: readonly CodeFactoryState[];
  /** Toggle one state in or out of the selection. */
  onToggle: (state: CodeFactoryState) => void;
}

/** Label each offered state through the one label map, keeping the two entry points identical. */
function useStateOptions(
  options: readonly CodeFactoryState[],
): readonly FilterOption<CodeFactoryState>[] {
  return React.useMemo(
    () => options.map((state) => ({ value: state, label: FACTORY_STATE_LABELS[state] })),
    [options],
  );
}

/**
 * The status checkboxes on their own, with no trigger — for a caller that already owns the menu
 * they sit in. Used by `StatusFilterMenu` below and by the board toolbar's mobile "Filter by
 * status" submenu (ALF-134), so the option list is defined once and both stay identical.
 */
export function StatusFilterItems({ options, selected, onToggle }: StatusFilterItemsProperties) {
  const stateOptions = useStateOptions(options);
  return <CheckboxFilterItems options={stateOptions} selected={selected} onToggle={onToggle} />;
}

export interface StatusFilterMenuProperties extends StatusFilterItemsProperties {
  /** Whether the selection differs from its default — surfaces the teal highlight + a count. */
  isFiltering: boolean;
}

/**
 * The shared "Filter by status" dropdown over the factory states. Used by both the Backlog (which
 * filters which stories are listed) and the project board (which filters which swimlane columns
 * are shown), so the two stay identical. The caller owns the selection state (see
 * `useStatusFilter`) and decides which `options` to offer.
 */
export function StatusFilterMenu({
  options,
  selected,
  onToggle,
  isFiltering,
}: StatusFilterMenuProperties) {
  const stateOptions = useStateOptions(options);
  return (
    <CheckboxFilterMenu
      label="Filter by status"
      options={stateOptions}
      selected={selected}
      onToggle={onToggle}
      isFiltering={isFiltering}
    />
  );
}
