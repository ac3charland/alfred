'use client';

import { ArrowDown, ArrowUp, MoreHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import { useFolderReorder } from '@/lib/hooks/use-folder-reorder';

import { folderActionsClass } from '../folder-nav.styles';

/**
 * A sidebar folder's "More actions" dropdown: **Move up / Move down** (the reorder path that
 * needs no pointer — the only one on touch, where the drag handle is hidden), then Edit, then a
 * destructive Delete below a divider. Each move entry is hidden at the end of the list it can't
 * travel toward, so the first folder offers no "Move up" and the last no "Move down".
 *
 * The reorder wiring lives here rather than in the nav so the list can `.map()` rows without
 * calling a hook per iteration.
 */
export function FolderNavMenu({
  folderId,
  name,
  onEdit,
  onDelete,
}: {
  folderId: string;
  /** The folder's name — the trigger's accessible label, so each row's menu is addressable. */
  name: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { canMoveUp, canMoveDown, moveUp, moveDown } = useFolderReorder(folderId);

  return (
    <div className={folderActionsClass}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label={`Options for ${name}`}>
            <MoreHorizontal size={12} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(canMoveUp || canMoveDown) && (
            <>
              {canMoveUp && (
                <DropdownMenuItem onSelect={moveUp}>
                  <ArrowUp size={16} className="text-muted-foreground" />
                  Move up
                </DropdownMenuItem>
              )}
              {canMoveDown && (
                <DropdownMenuItem onSelect={moveDown}>
                  <ArrowDown size={16} className="text-muted-foreground" />
                  Move down
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
