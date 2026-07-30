'use client';

import { MoreHorizontal } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';

/**
 * A habit's "More actions" dropdown: **Edit habit…**, **Archive**, then a destructive
 * **Delete habit…** below a divider — the same composition and naming `FolderNav`'s row menu
 * uses, with a confirm added to the delete because this one destroys data rather than re-homing it.
 *
 * Both trailing ellipses are load-bearing: those two items open a further step, while Archive
 * acts immediately (it is the reversible one, so putting a dialog in front of it would charge the
 * safe path the same friction as the destructive one).
 *
 * Always visible rather than hover-revealed. `FolderNav` reveals its menu on hover because a
 * sidebar row is small and dense; a habit card is a large surface with one menu on it, and a
 * hover-only control is a dead end on touch.
 */
export function HabitMenu({
  name,
  onEdit,
  onArchive,
  onDelete,
}: {
  /** The habit's name — the trigger's accessible label, so each card's menu is addressable. */
  name: string;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  // Whether this close came from PICKING something rather than dismissing the menu. See below.
  const picked = React.useRef(false);
  const pick = (act: () => void) => () => {
    picked.current = true;
    act();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={`Options for ${name}`}>
          <MoreHorizontal size={14} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Radix restores focus to the trigger when the menu closes — asynchronously, after its
        // exit animation. Every item here hands off to something else (a dialog, or an archive
        // that removes this very card), so that late focus jump lands on a control that has moved
        // on: it yanks focus out of the dialog just opened, closing any popover inside it that
        // doesn't autofocus its own content. Suppressed on a PICK only, so dismissing the menu
        // with Escape still returns focus where the keyboard user left it.
        onCloseAutoFocus={(event_) => {
          if (picked.current) event_.preventDefault();
          picked.current = false;
        }}
      >
        <DropdownMenuItem onSelect={pick(onEdit)}>Edit habit…</DropdownMenuItem>
        <DropdownMenuItem onSelect={pick(onArchive)}>Archive</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={pick(onDelete)}>
          Delete habit…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
