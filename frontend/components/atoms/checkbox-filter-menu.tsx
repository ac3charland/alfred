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

/** One checkbox in a filter menu: the value it selects and how it reads to the owner. */
export interface FilterOption<TValue extends string> {
  value: TValue;
  /** Rendered inside the checkbox item — a plain string, or a glyph + text for a tinted option. */
  label: React.ReactNode;
}

export interface CheckboxFilterItemsProperties<TValue extends string> {
  /** The options offered as checkboxes, in display order. */
  options: readonly FilterOption<TValue>[];
  /** The currently-selected values. */
  selected: readonly TValue[];
  /** Toggle one value in or out of the selection. */
  onToggle: (value: TValue) => void;
}

/**
 * The filter checkboxes on their own, with no trigger — for a caller that already owns the menu
 * they sit in (e.g. the board toolbar's mobile "Filter by status" submenu).
 *
 * Selecting an item does NOT close the menu, so several values can be toggled in one pass.
 */
export function CheckboxFilterItems<TValue extends string>({
  options,
  selected,
  onToggle,
}: CheckboxFilterItemsProperties<TValue>) {
  return options.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={selected.includes(option.value)}
      onCheckedChange={() => {
        onToggle(option.value);
      }}
      onSelect={(event) => {
        event.preventDefault();
      }}
    >
      {option.label}
    </DropdownMenuCheckboxItem>
  ));
}

export interface CheckboxFilterMenuProperties<
  TValue extends string,
> extends CheckboxFilterItemsProperties<TValue> {
  /** The trigger's text, e.g. "Filter by status". A count is appended while filtering. */
  label: string;
  /** Whether the selection differs from its default — surfaces the teal highlight + a count. */
  isFiltering: boolean;
}

/**
 * The shared multi-select filter dropdown: an outline trigger (highlighted teal with a count
 * while filtering) over a checkbox list. Every "Filter by X" control in the app is this
 * component, so they stay pixel- and behaviour-identical; the caller owns the selection state
 * (see `useStatusFilter` / `useProjectFilter`) and supplies the options and the trigger label.
 */
export function CheckboxFilterMenu<TValue extends string>({
  label,
  options,
  selected,
  onToggle,
  isFiltering,
}: CheckboxFilterMenuProperties<TValue>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={isFiltering ? 'outlineActive' : 'outline'} size="sm" className="gap-1.5">
          <ListFilter size={14} />
          {label}
          {isFiltering ? ` (${String(selected.length)})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <CheckboxFilterItems options={options} selected={selected} onToggle={onToggle} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
