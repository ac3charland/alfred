'use client';

import { Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import * as React from 'react';

import { Input } from '@/components/atoms/input';
import {
  type SearchResult,
  buildResults,
  flattenResults,
  optionDomId,
} from '@/components/shell/search-results';
import { SearchResultsPopover } from '@/components/shell/search-results-popover';
import { useGlobalSearchShortcut } from '@/components/shell/use-global-search-shortcut';
import { navigateToTaskAndFocus } from '@/components/tasks/navigate-to-task';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useCodeStories } from '@/lib/stores/code-store';
import { useFolders } from '@/lib/stores/folders-store';
import { useSearch, useSearchActions } from '@/lib/stores/search-store';
import { useTasks } from '@/lib/stores/tasks-store';
import { cn } from '@/lib/utils';

const DESKTOP_QUERY = '(min-width: 768px)';
const LISTBOX_ID = 'global-search-results';

interface SearchBoxProperties {
  /**
   * Which layout this field belongs to. The header field is `desktop`, the hamburger field is
   * `mobile`; each renders its results popover only on its own viewport (and only the desktop
   * field claims the ⌘P shortcut), so the two never both drop a dropdown at once.
   */
  placement?: 'desktop' | 'mobile';
  className?: string;
  /** Called after a result is chosen — the mobile drawer uses it to close itself. */
  onNavigate?: () => void;
}

/**
 * The top-bar global search field — the combobox trigger. It owns the `<input>`, opens the
 * anchored results dropdown on focus/typing, handles ↑↓/↵/Esc, and performs the navigation:
 * a task selection switches to its view + fires the row-focus event; a story selection opens
 * the board with `?story=<ref>`. Reads the already-seeded tasks/stories/folders stores and
 * filters client-side — no network round-trip.
 */
export function SearchBox({ placement = 'desktop', className, onNavigate }: SearchBoxProperties) {
  const { query, open } = useSearch();
  const { setQuery, openDropdown, closeDropdown } = useSearchActions();
  const tasks = useTasks();
  const stories = useCodeStories();
  const folders = useFolders();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const active = placement === 'desktop' ? isDesktop : !isDesktop;

  const focusInput = React.useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useGlobalSearchShortcut(focusInput, placement === 'desktop');

  const results = React.useMemo(
    () => buildResults(query, tasks, stories, folders),
    [query, tasks, stories, folders],
  );
  const flat = React.useMemo(() => flattenResults(results), [results]);

  // Reset the active option to the first match whenever the query changes (the derive-during-
  // render pattern — no setState effect).
  const [lastQuery, setLastQuery] = React.useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }
  // Keep the active index in range as the result set shrinks under the cursor.
  const clampedIndex = flat.length === 0 ? 0 : Math.min(activeIndex, flat.length - 1);
  const activeOption = open && flat.length > 0 ? flat[clampedIndex] : undefined;

  const select = React.useCallback(
    (result: SearchResult) => {
      // Client-side view switch (ViewLink convention). A task additionally scrolls its destination
      // row in + highlights it; a story just routes to the board with `?story=`.
      if (result.kind === 'task') {
        navigateToTaskAndFocus(result.id, result.href);
      } else {
        globalThis.history.pushState(null, '', result.href);
      }
      closeDropdown();
      inputRef.current?.blur();
      onNavigate?.();
    },
    [closeDropdown, onNavigate],
  );

  const handleKeyDown = (event_: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event_.key) {
      case 'Escape': {
        event_.preventDefault();
        closeDropdown();
        return;
      }
      case 'ArrowDown': {
        event_.preventDefault();
        openDropdown();
        if (flat.length > 0) setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
        return;
      }
      case 'ArrowUp': {
        event_.preventDefault();
        if (flat.length > 0) setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      case 'Enter': {
        const result = flat[clampedIndex];
        if (open && result !== undefined) {
          event_.preventDefault();
          select(result);
        }
        return;
      }
      default:
    }
  };

  return (
    <Popover.Root
      open={active && open}
      onOpenChange={(next) => {
        if (!next) closeDropdown();
      }}
      modal={false}
    >
      <Popover.Anchor asChild>
        <div className={cn('relative flex items-center', className)}>
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={active && open && flat.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? optionDomId(activeOption) : undefined}
            aria-label="Search tasks and stories"
            placeholder="Search…"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event_) => {
              setQuery(event_.target.value);
            }}
            onFocus={openDropdown}
            onKeyDown={handleKeyDown}
            className="h-8 pl-8 pr-12"
          />
          <kbd className="pointer-events-none absolute right-2 hidden rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ⌘P
          </kbd>
        </div>
      </Popover.Anchor>
      {active && (
        <SearchResultsPopover
          results={results}
          flat={flat}
          activeIndex={clampedIndex}
          query={query}
          listboxId={LISTBOX_ID}
          onSelect={select}
          onHover={setActiveIndex}
          onClose={closeDropdown}
          inputRef={inputRef}
        />
      )}
    </Popover.Root>
  );
}
