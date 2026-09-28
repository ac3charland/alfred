'use client';

import { Search } from 'lucide-react';
import * as React from 'react';

import { FullScreenDialog } from '@/components/atoms/dialog';
import { IconButton } from '@/components/atoms/icon-button';
import { Input } from '@/components/atoms/input';
import { SearchResultsList, SearchStatusRow } from '@/components/shell/search-results-list';
import { touchResultsRegionClass } from '@/components/shell/search-results-list.styles';
import { useGlobalSearchShortcut } from '@/components/shell/use-global-search-shortcut';
import { DESKTOP_QUERY, useSearchCombobox } from '@/components/shell/use-search-combobox';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useSearchActions } from '@/lib/stores/search-store';

const LISTBOX_ID = 'global-search-results-mobile';

/**
 * Global search on a phone: a header icon that opens a full-screen sheet holding the field, a
 * status row, and the full-width, touch-sized results. It shares its results, keyboard handling,
 * and navigation with the desktop header field through `useSearchCombobox`, and its open state
 * with it through the search store — gated to below `md`, so only one surface is ever open.
 *
 * The results render *inside* the dialog content rather than in a portalled popover: a modal
 * dialog's scroll lock leaves only its own content scrollable, so a list portalled outside it
 * can't be scrolled by touch or wheel. Dragging the list blurs the field, which dismisses the
 * on-screen keyboard (as native search screens do) so rows behind it can scroll into view.
 */
export function MobileSearch() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { openDropdown, closeDropdown } = useSearchActions();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const combobox = useSearchCombobox({ inputRef });
  const { open, flat } = combobox;
  const sheetOpen = !isDesktop && open;
  useGlobalSearchShortcut(openDropdown, !isDesktop);

  const dismissKeyboard = () => {
    if (inputRef.current !== null && document.activeElement === inputRef.current) {
      inputRef.current.blur();
    }
  };

  return (
    <>
      <IconButton size="lg" aria-label="Search" className="md:hidden" onClick={openDropdown}>
        <Search size={18} />
      </IconButton>
      <FullScreenDialog
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) closeDropdown();
        }}
        title="Search"
        closeLabel="Close search"
        // Radix would focus the × first; land on the field instead so the keyboard comes up.
        onOpenAutoFocus={(event_) => {
          event_.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="relative flex shrink-0 items-center px-4 py-3">
            <Search
              size={16}
              className="pointer-events-none absolute left-7 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={sheetOpen && flat.length > 0}
              aria-controls={LISTBOX_ID}
              aria-autocomplete="list"
              aria-activedescendant={combobox.activeDescendant}
              aria-label="Search tasks, stories, and wiki pages"
              placeholder="Search…"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="go"
              value={combobox.query}
              onChange={(event_) => {
                combobox.setQuery(event_.target.value);
              }}
              onKeyDown={combobox.handleKeyDown}
              className="h-11 pl-10 text-base"
            />
          </div>
          {combobox.query.trim() !== '' && (
            <SearchStatusRow
              count={flat.length}
              showCompleted={combobox.showCompleted}
              onShowCompletedChange={combobox.setShowCompleted}
            />
          )}
          <div
            data-testid="search-results-region"
            className={touchResultsRegionClass}
            onTouchMove={dismissKeyboard}
          >
            <SearchResultsList
              density="touch"
              results={combobox.results}
              flat={flat}
              activeIndex={combobox.activeIndex}
              query={combobox.query}
              listboxId={LISTBOX_ID}
              onSelect={combobox.select}
              onHover={combobox.setActiveIndex}
              showCompleted={combobox.showCompleted}
              onShowCompletedChange={combobox.setShowCompleted}
            />
          </div>
        </div>
      </FullScreenDialog>
    </>
  );
}
