'use client';

import { ArrowUpDown, Check } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import {
  DEFAULT_TASK_SORT,
  TASK_SORT_OPTIONS,
  type TaskSortMode,
  taskSortOption,
} from '@/lib/tasks/task-sort';

export interface FolderSortMenuProperties {
  /** The ordering the folder is showing. */
  value: TaskSortMode;
  /** Switch the folder to another ordering. */
  onChange: (next: TaskSortMode) => void;
}

/**
 * The folder header's "Sort by" control: an outline trigger naming the current ordering over a
 * two-item menu (Priority / Due date), check-marking the active one. Sits beside Collapse-all in
 * the same header cluster, and takes the teal treatment once the folder is off the default
 * ordering — the same "this view is not at rest" signal the Code views' status filter gives.
 */
export function FolderSortMenu({ value, onChange }: FolderSortMenuProperties) {
  const isCustomSort = value !== DEFAULT_TASK_SORT;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={isCustomSort ? 'outlineActive' : 'outline'} size="sm" className="gap-1.5">
          <ArrowUpDown size={14} />
          Sort by: {taskSortOption(value).label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {TASK_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => {
              onChange(option.value);
            }}
            className="justify-between gap-6"
          >
            <span className="flex items-center gap-2">
              <option.icon size={12} className="shrink-0 text-muted-foreground" />
              {option.label}
            </span>
            {value === option.value && <Check size={12} className="text-accent-teal" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
