'use client';

import { Popover } from 'radix-ui';
import * as React from 'react';

import { SearchResultsList } from '@/components/shell/search-results-list';
import { cn } from '@/lib/utils';

type SearchResultsPopoverProperties = Omit<
  React.ComponentProps<typeof SearchResultsList>,
  'density'
> & {
  onClose: () => void;
  /** The field the popover anchors to — pointer-downs on it must not count as "outside". */
  inputRef: React.RefObject<HTMLInputElement | null>;
};

/**
 * The results panel anchored beneath the desktop header field (Radix `Popover`, non-modal so the
 * input keeps focus). It wraps the shared compact `SearchResultsList`; the field + this dropdown
 * together form one combobox. Reads nothing itself — `SearchBox` hands it the already-built
 * results.
 */
export function SearchResultsPopover({
  onClose,
  inputRef,
  ...listProps
}: SearchResultsPopoverProperties) {
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
        <SearchResultsList density="compact" {...listProps} />
      </Popover.Content>
    </Popover.Portal>
  );
}
