'use client';

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

import {
  type SearchResultsDensity,
  optionRowDensityClass,
  touchStatusRowClass,
} from './search-results-list.styles';

interface SearchResultsListProperties {
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
  /** Whether completed tasks / terminal stories are included in `results`. */
  showCompleted: boolean;
  onShowCompletedChange: (next: boolean) => void;
  /**
   * `compact` is the desktop dropdown: dense rows, "Show completed" at the top, key hints and the
   * count in a footer. `touch` is the mobile sheet: 44px rows and no key-hint footer — the sheet
   * renders the count and "Show completed" in its own `SearchStatusRow` above the scroll region.
   */
  density: SearchResultsDensity;
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

function resultCountLabel(count: number): string {
  return `${String(count)} result${count === 1 ? '' : 's'}`;
}

/** One result row. */
function OptionRow({
  result,
  active,
  density,
  onSelect,
  onHover,
}: {
  result: SearchResult;
  active: boolean;
  density: SearchResultsDensity;
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
        optionRowDensityClass[density],
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
  density,
  onSelect,
  onHover,
}: {
  label: string;
  groupResults: SearchResult[];
  truncated: number;
  baseIndex: number;
  activeIndex: number;
  density: SearchResultsDensity;
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
              density={density}
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
 * The mobile sheet's status row: the result count on the left and "Show completed" on the right.
 * On touch it stands in for the desktop dropdown's checkbox row and key-hint footer.
 */
export function SearchStatusRow({
  count,
  showCompleted,
  onShowCompletedChange,
}: {
  count: number;
  showCompleted: boolean;
  onShowCompletedChange: (next: boolean) => void;
}) {
  return (
    <div data-testid="search-status-row" className={touchStatusRowClass}>
      <span>{resultCountLabel(count)}</span>
      <CheckboxField
        label="Show completed"
        checked={showCompleted}
        onCheckedChange={onShowCompletedChange}
      />
    </div>
  );
}

/**
 * The grouped search `listbox` (Tasks / Stories / Wiki), with the empty-query and no-match
 * messages — the body both search surfaces render, so the desktop dropdown and the mobile sheet
 * show the same rows. Reads nothing itself: the caller hands it the already-built results.
 */
export function SearchResultsList({
  results,
  flat,
  activeIndex,
  query,
  listboxId,
  onSelect,
  onHover,
  showCompleted,
  onShowCompletedChange,
  density,
}: SearchResultsListProperties) {
  const trimmed = query.trim();
  const compact = density === 'compact';

  if (trimmed === '') {
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">
        Search tasks, stories, and wiki pages
      </p>
    );
  }

  const groupProps = { activeIndex, density, onSelect, onHover };

  return (
    <>
      {compact && (
        <div className="flex items-center justify-end border-b border-border px-2 pb-1.5 pt-1">
          <CheckboxField
            label="Show completed"
            checked={showCompleted}
            onCheckedChange={onShowCompletedChange}
          />
        </div>
      )}
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
              {...groupProps}
            />
            <Group
              label="Stories"
              groupResults={results.stories}
              truncated={results.truncated.stories}
              baseIndex={results.tasks.length}
              {...groupProps}
            />
            <Group
              label="Wiki"
              groupResults={results.wiki}
              truncated={results.truncated.wiki}
              baseIndex={results.tasks.length + results.stories.length}
              {...groupProps}
            />
          </ul>
          {compact && (
            <div className="mt-1 flex items-center gap-3 border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground/70">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
              <span className="ml-auto">{resultCountLabel(flat.length)}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
