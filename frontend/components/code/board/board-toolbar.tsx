'use client';

import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListFilter,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { StatusFilterItems, StatusFilterMenu } from '@/components/code/status-filter-menu';
import type { CodeFactoryState } from '@/lib/types';

export interface BoardToolbarProperties {
  /** Open the new-epic dialog. */
  onCreateEpic: () => void;
  /** Whether the board shows any epic — the collapse-all control has nothing to act on if not. */
  hasVisibleEpics: boolean;
  /** True when every visible epic is collapsed, so the control offers "Open all" instead. */
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
  /** The factory states offered by "Filter by status", in display order. */
  statusOptions: readonly CodeFactoryState[];
  /** The states whose swimlanes are currently shown. */
  selectedStatuses: readonly CodeFactoryState[];
  onToggleStatus: (state: CodeFactoryState) => void;
  /** Whether the status selection differs from its default (drives the teal + count). */
  isFiltering: boolean;
  showAbandoned: boolean;
  onToggleAbandoned: () => void;
  /** Whether the project has any archived epic — "Show archived" is absent when it doesn't. */
  hasArchivedEpics: boolean;
  showArchived: boolean;
  onToggleArchived: () => void;
}

/**
 * The project board's header controls.
 *
 * The row is **responsive by CSS, not by viewport state** (like the shell's sidebar/hamburger
 * swap), so the correct layout is server-rendered with no post-hydration flash:
 *
 * - **"Create epic" stays put** at every width — it's the board's primary action.
 * - **Collapse all / Open all condenses to a chevron glyph below `md`** (ALF-134). The label is
 *   `sr-only md:not-sr-only` rather than removed, so the accessible name is the same string at
 *   every viewport.
 * - **The three view filters** — Filter by status, Show abandoned, Show archived — sit inline from
 *   `md` up and fold into a single **⋯ menu** below it (ALF-134), where the status options become
 *   a submenu and the two toggles become checkbox items. The ⋯ trigger carries the same teal
 *   treatment its folded-away controls do, so an active filter isn't invisible on a phone.
 */
export function BoardToolbar({
  onCreateEpic,
  hasVisibleEpics,
  allCollapsed,
  onToggleCollapseAll,
  statusOptions,
  selectedStatuses,
  onToggleStatus,
  isFiltering,
  showAbandoned,
  onToggleAbandoned,
  hasArchivedEpics,
  showArchived,
  onToggleArchived,
}: BoardToolbarProperties) {
  const collapseLabel = allCollapsed ? 'Open all' : 'Collapse all';
  const CollapseGlyph = allCollapsed ? ChevronsUpDown : ChevronsDownUp;
  const anyFilterActive = isFiltering || showAbandoned || showArchived;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onCreateEpic}>
        <Plus size={14} />
        Create epic
      </Button>

      {hasVisibleEpics ? (
        <ToggleButton
          pressed={false}
          onToggle={onToggleCollapseAll}
          // On a phone this sits between "Create epic" and the ⋯, both `Button size="sm"` —
          // take their height so the row reads as one bar. From `md` up it's back among the
          // other pill toggles, so it relaxes to their height.
          className="h-8 md:h-auto"
        >
          <CollapseGlyph size={14} className="md:hidden" />
          <span className="sr-only md:not-sr-only">{collapseLabel}</span>
        </ToggleButton>
      ) : null}

      {/* md and up: the view filters inline, one control each. */}
      <div className="hidden items-center gap-2 md:flex">
        <StatusFilterMenu
          options={statusOptions}
          selected={selectedStatuses}
          onToggle={onToggleStatus}
          isFiltering={isFiltering}
        />
        <ToggleButton pressed={showAbandoned} onToggle={onToggleAbandoned}>
          Show abandoned
        </ToggleButton>
        {hasArchivedEpics ? (
          <ToggleButton pressed={showArchived} onToggle={onToggleArchived}>
            <Archive size={12} />
            Show archived
          </ToggleButton>
        ) : null}
      </div>

      {/* Below md: the same three filters folded into one ⋯ menu. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={anyFilterActive ? 'outlineActive' : 'outline'}
            size="sm"
            aria-label="Board filters"
            className="px-2 md:hidden"
          >
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex items-center gap-1.5">
                <ListFilter size={13} />
                Filter by status
                {isFiltering ? ` (${String(selectedStatuses.length)})` : ''}
              </span>
              <ChevronRight size={12} className="text-muted-foreground" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <StatusFilterItems
                options={statusOptions}
                selected={selectedStatuses}
                onToggle={onToggleStatus}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuCheckboxItem
            checked={showAbandoned}
            onCheckedChange={onToggleAbandoned}
            // Keep the menu open so several filters can be flipped in one pass (as the
            // status checkboxes do).
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            Show abandoned
          </DropdownMenuCheckboxItem>
          {hasArchivedEpics ? (
            <DropdownMenuCheckboxItem
              checked={showArchived}
              onCheckedChange={onToggleArchived}
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              <Archive size={13} />
              Show archived
            </DropdownMenuCheckboxItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
