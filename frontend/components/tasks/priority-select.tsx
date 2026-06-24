'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { PRIORITY_OPTIONS, type TaskPriority, priorityOption } from '@/lib/priority';

interface PriorityMenuProperties {
  /** The current level, or `null` for unprioritised. */
  value: TaskPriority | null;
  /** Persist a level, or `null` to clear. */
  onChange: (next: TaskPriority | null) => void;
  /** The trigger element (rendered via Radix `asChild`). */
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
}

/**
 * The shared priority dropdown — "No priority" plus the three {@link PRIORITY_OPTIONS} levels,
 * check-marking the active one. Wraps any trigger (`children`) so both the editor field
 * (`PrioritySelect`) and the By-Priority row's chip can re-prioritise in place from one menu.
 */
export function PriorityMenu({
  value,
  onChange,
  children,
  align = 'start',
}: PriorityMenuProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem
          onSelect={() => {
            onChange(null);
          }}
          className="justify-between"
        >
          <span className="text-muted-foreground">No priority</span>
          {value === null && <Check size={12} className="text-accent-teal" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PRIORITY_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => {
              onChange(option.value);
            }}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <option.icon size={12} className="shrink-0" />
              {option.label}
            </span>
            {value === option.value && <Check size={12} className="text-accent-teal" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PrioritySelectProperties {
  /** The id the meta-panel's `FieldLabel` associates with. */
  id: string;
  value: TaskPriority | null;
  onChange: (next: TaskPriority | null) => void;
}

/**
 * The **Priority** control in a task's meta panel: a trigger showing the current level (or
 * "No priority"), opening the shared {@link PriorityMenu}. Picking a value is a single atomic
 * choice (no draft/save dance like the free-text due-date / notes fields), so it writes straight
 * through the optimistic `updateTask` path the caller wires to `onChange`.
 */
export function PrioritySelect({ id, value, onChange }: PrioritySelectProperties) {
  return (
    <PriorityMenu value={value} onChange={onChange}>
      <InlineEditTrigger
        id={id}
        className="text-sm text-foreground hover:text-accent-teal transition-colors motion-reduce:transition-none focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {value === null ? (
          <span className="text-muted-foreground">No priority</span>
        ) : (
          priorityOption(value).label
        )}
      </InlineEditTrigger>
    </PriorityMenu>
  );
}
