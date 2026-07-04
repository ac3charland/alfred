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
import { PRIORITY_OPTIONS, type TaskPriority } from '@/lib/priority';
import { cn } from '@/lib/utils';

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
 * check-marking the active one. Wraps any trigger (`children`) so the By-Priority row's chip can
 * re-prioritise in place from one menu.
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
              <option.icon size={12} className={cn('shrink-0', option.iconClass)} />
              {option.label}
            </span>
            {value === option.value && <Check size={12} className="text-accent-teal" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
