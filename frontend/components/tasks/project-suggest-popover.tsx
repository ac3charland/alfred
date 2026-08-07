'use client';

import { GitBranch } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { PopoverContent } from '@/components/atoms/popover';
import { projectBadgeClasses, projectColorFor, projectTextClasses } from '@/lib/code/project-color';
import { projectSuggestionDomId } from '@/lib/code/project-suggestions';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProjectSuggestPopoverProperties {
  /** The ranked matches to draw, best first. */
  suggestions: readonly Project[];
  /**
   * The full project list in store order. Project colours are positional, so a row still resolves
   * its own colour after ranking has reordered it out of that sequence.
   */
  projects: readonly Project[];
  activeIndex: number;
  /** The listbox's DOM id (the capture box's `aria-controls`). */
  listboxId: string;
  onSelect: (project: Project) => void;
  /** Hovering a row makes it the active option, so mouse and keyboard agree. */
  onHover: (index: number) => void;
  onClose: () => void;
  /** The field the popover anchors to — pointer-downs on it must not count as "outside". */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/** One project row: the branch glyph in the project's colour, its name, and its key pill. */
function OptionRow({
  project,
  color,
  active,
  onSelect,
  onHover,
}: {
  project: Project;
  color: ReturnType<typeof projectColorFor>;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <li
      id={projectSuggestionDomId(project)}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      // Keep focus in the capture box: a mousedown would otherwise blur it before the click fires.
      onMouseDown={(event_) => {
        event_.preventDefault();
      }}
      onMouseEnter={onHover}
      onClick={onSelect}
      // The combobox drives selection from the capture box (arrows + Enter), but keep the option
      // independently operable for any client that focuses it directly.
      onKeyDown={(event_) => {
        if (event_.key === 'Enter' || event_.key === ' ') {
          event_.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground',
        active && 'bg-secondary ring-1 ring-inset ring-accent-teal',
      )}
    >
      <GitBranch size={14} className={cn('shrink-0', projectTextClasses(color))} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <Badge variant="plain" className={cn('font-mono font-medium', projectBadgeClasses(color))}>
        {project.key}
      </Badge>
    </li>
  );
}

/**
 * The project list anchored beneath the Inbox capture box, opened by a leading `:`. The box and
 * this panel together form one combobox: the box owns the value, the active index and the key
 * handling, and this renders whatever it's handed — it reads no store of its own.
 *
 * Selecting a row only writes `<KEY>: ` into the box; classification still happens in the
 * submit-time prefix parse, so the panel never carries hidden state.
 */
export function ProjectSuggestPopover({
  suggestions,
  projects,
  activeIndex,
  listboxId,
  onSelect,
  onHover,
  onClose,
  anchorRef,
}: ProjectSuggestPopoverProperties) {
  // The colour rule reads a project's slot in the store order, so resolve against that list
  // rather than the ranked one.
  const ordered = [...projects];

  return (
    <PopoverContent
      // The box stays focused; the panel is a passive listbox, never a focus trap.
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
      onCloseAutoFocus={(event_) => {
        event_.preventDefault();
      }}
      // A pointer-down on the anchored capture surface is not "outside" — ignore it so the box
      // keeping focus doesn't bounce the panel closed.
      onInteractOutside={(event_) => {
        if (anchorRef.current?.contains(event_.target as Node) === true) {
          event_.preventDefault();
          return;
        }
        onClose();
      }}
      style={{ width: 'var(--radix-popover-trigger-width)' }}
      className="max-h-[60vh] overflow-y-auto"
    >
      <ul id={listboxId} role="listbox" aria-label="Projects">
        {suggestions.map((project, index) => (
          <OptionRow
            key={project.id}
            project={project}
            color={projectColorFor(ordered, project.id)}
            active={index === activeIndex}
            onSelect={() => {
              onSelect(project);
            }}
            onHover={() => {
              onHover(index);
            }}
          />
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-3 border-t border-[#25324a] px-2 py-1.5 text-[11px] text-muted-foreground/70">
        <span>↑↓ navigate</span>
        <span>↵ insert</span>
        <span>esc dismiss</span>
      </div>
    </PopoverContent>
  );
}
