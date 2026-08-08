'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import { OptionButton } from '@/components/atoms/option-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';

/**
 * A row in a picker popover's list: a left-aligned option with an optional leading icon and a
 * trailing teal check when it's the current value — and nothing else (no fill on the selected
 * row; that teal wash belongs to the gate's `OptionRow`, a different component). Built on the
 * shared `OptionButton` list-row atom.
 */
export function PickerListItem({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <OptionButton onClick={onSelect} className="text-[13px] text-card-foreground">
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {active && <Check size={14} className="shrink-0 text-accent-teal" />}
    </OptionButton>
  );
}

/** One selectable entry. `value: null` is a clear entry ("No folder" / "No project" / "Never"). */
export interface PickerChipOption {
  value: string | null;
  label: React.ReactNode;
}

interface PickerChipProperties {
  /** The chip/badge button that opens the picker — becomes the Popover trigger (`asChild`). */
  trigger: React.ReactElement;
  options: PickerChipOption[];
  /** The current value, ticked in the list. */
  value: string | null;
  /** A pick auto-saves and closes the popover. */
  onSelect: (value: string | null) => void;
}

/**
 * The shared chip-plus-popover single-select primitive behind the detail/row picker chips
 * (Folder, Project, Epic, Repeat): a trigger chip opening a compact popover of
 * {@link PickerListItem} rows, the active one marked by a trailing teal check. Picking calls
 * `onSelect` and closes — the auto-save chip contract the Due / Repeat / Priority chips set.
 */
export function PickerChip({ trigger, options, value, onSelect }: PickerChipProperties) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="max-h-[264px] w-[186px] overflow-y-auto">
        {options.map((option) => (
          <PickerListItem
            key={option.value ?? '(none)'}
            active={option.value === value}
            onSelect={() => {
              onSelect(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </PickerListItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}
