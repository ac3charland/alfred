'use client';

import { ListFilter } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
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

/**
 * The status checkboxes on their own, with no trigger — for a caller that already owns the menu
 * they sit in. Used by `StatusFilterMenu` below and by the board toolbar's mobile "Filter by
 * status" submenu (ALF-134), so the option list is defined once and both stay identical.
 */
export function StatusFilterItems({ options, selected, onToggle }: StatusFilterItemsProperties) {
  return options.map((state) => (
    <DropdownMenuCheckboxItem
      key={state}
      checked={selected.includes(state)}
      onCheckedChange={() => {
        onToggle(state);
      }}
      // Keep the menu open so several statuses can be toggled in one pass.
      onSelect={(event) => {
        event.preventDefault();
      }}
    >
      {FACTORY_STATE_LABELS[state]}
    </DropdownMenuCheckboxItem>
  ));
}

export interface StatusFilterMenuProperties extends StatusFilterItemsProperties {
  /** Whether the selection differs from its default — surfaces the teal highlight + a count. */
  isFiltering: boolean;
}

/**
 * The shared "Filter by status" dropdown: an outline trigger (highlighted teal with a count while
 * filtering) over a checkbox list of factory states. Used by both the Backlog (which filters which
 * stories are listed) and the project board (which filters which swimlane columns are shown), so
 * the two stay pixel- and behaviour-identical. The caller owns the selection state (see
 * `useStatusFilter`) and decides which `options` to offer.
 */
export function StatusFilterMenu({
  options,
  selected,
  onToggle,
  isFiltering,
}: StatusFilterMenuProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={isFiltering ? 'outlineActive' : 'outline'} size="sm" className="gap-1.5">
          <ListFilter size={14} />
          Filter by status
          {isFiltering ? ` (${String(selected.length)})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <StatusFilterItems options={options} selected={selected} onToggle={onToggle} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
