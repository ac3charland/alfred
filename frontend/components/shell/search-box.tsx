'use client';

import { Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import * as React from 'react';

import { Input } from '@/components/atoms/input';
import { SearchResultsPopover } from '@/components/shell/search-results-popover';
import { useGlobalSearchShortcut } from '@/components/shell/use-global-search-shortcut';
import { DESKTOP_QUERY, useSearchCombobox } from '@/components/shell/use-search-combobox';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useSearchActions } from '@/lib/stores/search-store';
import { cn } from '@/lib/utils';

const LISTBOX_ID = 'global-search-results';

interface SearchBoxProperties {
  className?: string;
}

/**
 * The desktop header's global search field — the combobox trigger. It owns the `<input>`, opens
 * the anchored results dropdown on focus/typing, and claims ⌘P; the results, keyboard handling,
 * and navigation come from `useSearchCombobox`, shared with the mobile sheet (`MobileSearch`).
 *
 * The dropdown only opens at `md`+. The store's `open` flag is shared with the mobile sheet, so
 * without that gate opening the sheet on a phone would also drop a popover anchored to this
 * (hidden) field.
 */
export function SearchBox({ className }: SearchBoxProperties) {
  const { openDropdown, closeDropdown } = useSearchActions();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const combobox = useSearchCombobox({ inputRef });
  const { open, flat } = combobox;

  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const focusInput = React.useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useGlobalSearchShortcut(focusInput, isDesktop);

  return (
    <Popover.Root
      open={isDesktop && open}
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
            aria-expanded={isDesktop && open && flat.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={combobox.activeDescendant}
            aria-label="Search tasks, stories, and wiki pages"
            placeholder="Search…"
            spellCheck={false}
            autoComplete="off"
            value={combobox.query}
            onChange={(event_) => {
              combobox.setQuery(event_.target.value);
            }}
            onFocus={openDropdown}
            onKeyDown={combobox.handleKeyDown}
            className="h-8 pl-8 pr-12"
          />
          <kbd className="pointer-events-none absolute right-2 hidden rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ⌘P
          </kbd>
        </div>
      </Popover.Anchor>
      {isDesktop && (
        <SearchResultsPopover
          results={combobox.results}
          flat={flat}
          activeIndex={combobox.activeIndex}
          query={combobox.query}
          listboxId={LISTBOX_ID}
          onSelect={combobox.select}
          onHover={combobox.setActiveIndex}
          onClose={closeDropdown}
          inputRef={inputRef}
          showCompleted={combobox.showCompleted}
          onShowCompletedChange={combobox.setShowCompleted}
        />
      )}
    </Popover.Root>
  );
}
