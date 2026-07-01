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
import { cn } from '@/lib/utils';

export interface StatusFilterMenuProperties {
  /** The factory states offered as checkboxes, in display order. */
  options: readonly CodeFactoryState[];
  /** The currently-selected states. */
  selected: readonly CodeFactoryState[];
  /** Toggle one state in or out of the selection. */
  onToggle: (state: CodeFactoryState) => void;
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
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'gap-1.5',
            isFiltering &&
              'border-accent-teal/60 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/10 hover:text-accent-teal',
          )}
        >
          <ListFilter size={14} />
          Filter by status
          {isFiltering ? ` (${String(selected.length)})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((state) => (
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
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
