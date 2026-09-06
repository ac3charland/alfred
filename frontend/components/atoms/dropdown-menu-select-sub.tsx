'use client';

import { Check, ChevronRight } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/atoms/dropdown-menu';
import type { PickerChipOption } from '@/components/atoms/picker-chip';

interface DropdownMenuSelectSubProperties {
  /** The sub-trigger's label, e.g. "Priority…". */
  label: string;
  /** The current value, ticked in the list. `null` matches a clear entry. */
  value: string | null;
  options: readonly PickerChipOption[];
  onSelect: (value: string | null) => void;
  /**
   * Disable the trigger. `hint` then becomes its `title` **and** renders as visible muted text
   * beside the label: a disabled sub-trigger is `pointer-events-none`, so it is never a hover
   * target and the browser draws no tooltip — and on touch there is none to draw. The `title`
   * stays for assistive tech; the visible span is for everyone else.
   */
  disabled?: boolean;
  hint?: string;
  /**
   * Draw a `DropdownMenuSeparator` after this option index (0-based). Priority passes 0, after
   * "No priority"; the due-date submenu passes 2, after the third preset, in BOTH its shapes so
   * the divider doesn't move when "No due date" appears. Omit for a list that needs no divider.
   */
  separatorAfter?: number;
}

/**
 * The menu twin of {@link PickerChip}: a submenu of single-select options, the active one
 * carrying a trailing teal {@link Check}. Takes the same {@link PickerChipOption} list the
 * popover pickers take, so a field offers the same entries whichever surface it is edited from.
 *
 * For **submenus** specifically. The top-level priority menu, the chip popovers and the row
 * menu's bespoke "Move to…" list stay as they are — they are a menu, a popover and a
 * destination list, not five copies of this one shape.
 */
export function DropdownMenuSelectSub({
  label,
  value,
  options,
  onSelect,
  disabled = false,
  hint,
  separatorAfter,
}: DropdownMenuSelectSubProperties) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} title={disabled ? hint : undefined}>
        <span className="flex min-w-0 items-center gap-2">
          {label}
          {disabled && hint !== undefined && (
            <span className="truncate text-xs text-muted-foreground">{hint}</span>
          )}
        </span>
        <ChevronRight size={12} className="text-muted-foreground" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {options.map((option, index) => (
          <React.Fragment key={option.value ?? '(none)'}>
            <DropdownMenuItem
              className="justify-between"
              onSelect={() => {
                onSelect(option.value);
              }}
            >
              <span className="flex min-w-0 items-center gap-2">{option.label}</span>
              {option.value === value && <Check size={12} className="text-accent-teal" />}
            </DropdownMenuItem>
            {index === separatorAfter && <DropdownMenuSeparator />}
          </React.Fragment>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
