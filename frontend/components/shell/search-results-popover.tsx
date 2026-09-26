'use client';

import { Popover } from 'radix-ui';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { CheckboxField } from '@/components/atoms/checkbox-field';
import {
  type SearchResult,
  type SearchResults,
  optionDomId,
} from '@/components/shell/search-results';
import { GROUP_LABEL_CLASS } from '@/lib/ui/group-label-class';
import { cn } from '@/lib/utils';

interface SearchResultsPopoverProperties {
  results: SearchResults;
  /** All three groups concatenated, in keyboard-nav order, so the active index maps across them. */
  flat: SearchResult[];
  activeIndex: number;
  query: string;
  /** The listbox's DOM id (the input's `aria-controls`). */
  listboxId: string;
  onSelect: (result: SearchResult) => void;
  /** Hovering a row makes it the active option, so mouse and keyboard agree. */
  onHover: (index: number) => void;
  onClose: () => void;
  /** The field the popover anchors to — pointer-downs on it must not count as "outside". */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Whether completed tasks / terminal stories are included in `results`. */
  showCompleted: boolean;
  onShowCompletedChange: (next: boolean) => void;
}

/** The row badge's tone and label, by result kind. */
const KIND_BADGE: Record<
  SearchResult['kind'],
  { variant: 'accent' | 'alert' | 'wiki'; label: string }
> = {
  task: { variant: 'accent', label: 'Task' },
  story: { variant: 'alert', label: 'Code' },
  wiki: { variant: 'wiki', label: 'Wiki' },
};

/** One result row. */
function OptionRow({
  result,
  active,
  onSelect,
  onHover,
}: {
  result: SearchResult;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <li
      id={optionDomId(result)}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      // Keep focus on the input: a mousedown would otherwise blur it before the click fires.
      onMouseDown={(event_) => {
        event_.preventDefault();
      }}
      onMouseEnter={onHover}
      onClick={onSelect}
      // The combobox drives selection from the input (arrows + Enter), but keep the option
      // independently operable for any client that focuses it directly.
      onKeyDown={(event_) => {
        if (event_.key === 'Enter' || event_.key === ' ') {
          event_.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
        active && 'bg-secondary ring-1 ring-inset ring-accent-teal',
        result.completed && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">
          {result.kind === 'story' && result.ref !== '' ? (
            <span className="mr-1.5 font-mono text-xs text-accent-amber">{result.ref}</span>
          ) : null}
          {result.title}
        </span>
        {result.subtitle !== '' && (
          <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
        )}
      </div>
      <Badge variant={KIND_BADGE[result.kind].variant} className="font-medium">
        {KIND_BADGE[result.kind].label}
      </Badge>
    </li>
  );
}

/** A labelled group (Tasks / Stories / Wiki) with its options and a capped "+N more" line. */
function Group({
  label,
  groupResults,
  truncated,
  baseIndex,
  activeIndex,
  onSelect,
  onHover,
}: {
  label: string;
  groupResults: SearchResult[];
  truncated: number;
  baseIndex: number;
  activeIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
}) {
  if (groupResults.length === 0) return null;
  return (
    <li>
      <div className={GROUP_LABEL_CLASS}>{label}</div>
      <ul>
        {groupResults.map((result, offset) => {
          const index = baseIndex + offset;
          return (
            <OptionRow
              key={optionDomId(result)}
              result={result}
              active={index === activeIndex}
              onSelect={() => {
                onSelect(result);
              }}
              onHover={() => {
                onHover(index);
              }}
            />
          );
        })}
      </ul>
      {truncated > 0 && (
        <div className="px-2 py-1 text-xs text-muted-foreground/70">
          +{truncated} more — keep typing
        </div>
      )}
    </li>
  );
}

/**
 * The results panel anchored beneath the top-bar field (Radix `Popover`, non-modal so the
 * input keeps focus). It renders the grouped `listbox`; the field + this dropdown together form
 * one combobox. Reads nothing itself — `SearchBox` hands it the already-built results.
 */
export function SearchResultsPopover({
  results,
  flat,
  activeIndex,
  query,
  listboxId,
  onSelect,
  onHover,
  onClose,
  inputRef,
  showCompleted,
  onShowCompletedChange,
}: SearchResultsPopoverProperties) {
  const trimmed = query.trim();

  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={6}
        // The field stays focused; the dropdown is a passive listbox, never a focus trap.
        onOpenAutoFocus={(event_) => {
          event_.preventDefault();
        }}
        onCloseAutoFocus={(event_) => {
          event_.preventDefault();
        }}
        // A pointer-down on the anchored input is not "outside" — ignore it so the field
        // staying focused doesn't bounce the dropdown closed.
        onInteractOutside={(event_) => {
          if (inputRef.current?.contains(event_.target as Node)) {
            event_.preventDefault();
            return;
          }
          onClose();
        }}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        className={cn(
          'z-50 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-md',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'motion-reduce:animate-none',
        )}
      >
        {trimmed === '' ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Search tasks, stories, and wiki pages
          </p>
        ) : (
          <>
            <div className="flex items-center justify-end border-b border-border px-2 pb-1.5 pt-1">
              <CheckboxField
                label="Show completed"
                checked={showCompleted}
                onCheckedChange={onShowCompletedChange}
              />
            </div>
            {flat.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No matches for “{trimmed}”</p>
            ) : (
              <>
                <ul id={listboxId} role="listbox" aria-label="Search results">
                  <Group
                    label="Tasks"
                    groupResults={results.tasks}
                    truncated={results.truncated.tasks}
                    baseIndex={0}
                    activeIndex={activeIndex}
                    onSelect={onSelect}
                    onHover={onHover}
                  />
                  <Group
                    label="Stories"
                    groupResults={results.stories}
                    truncated={results.truncated.stories}
                    baseIndex={results.tasks.length}
                    activeIndex={activeIndex}
                    onSelect={onSelect}
                    onHover={onHover}
                  />
                  <Group
                    label="Wiki"
                    groupResults={results.wiki}
                    truncated={results.truncated.wiki}
                    baseIndex={results.tasks.length + results.stories.length}
                    activeIndex={activeIndex}
                    onSelect={onSelect}
                    onHover={onHover}
                  />
                </ul>
                <div className="mt-1 flex items-center gap-3 border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground/70">
                  <span>↑↓ navigate</span>
                  <span>↵ open</span>
                  <span>esc close</span>
                  <span className="ml-auto">
                    {flat.length} result{flat.length === 1 ? '' : 's'}
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </Popover.Content>
    </Popover.Portal>
  );
}
