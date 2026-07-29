'use client';

import { computeInsertOrder } from '@/lib/dnd/reorder-subtask';
import { useFolderActions, useFolders } from '@/lib/stores/folders-store';

/** The "Move up" / "Move down" reorder affordance for one folder row. */
export interface FolderReorderControls {
  /** True when the folder can move up (it isn't already first). */
  canMoveUp: boolean;
  /** True when the folder can move down (it isn't already last). */
  canMoveDown: boolean;
  /** Move the folder up one slot in the sidebar list. */
  moveUp: () => void;
  /** Move the folder down one slot in the sidebar list. */
  moveDown: () => void;
}

/**
 * The pointer-free folder reorder path (ALF-153): "Move up" / "Move down" in a folder's row
 * menu. It's how the list is reordered on touch — the drag handle is desktop-only — and it's
 * the keyboard/screen-reader path everywhere. Each move computes the fractional `sort_order`
 * of the slot it swaps past (the same midpoint math as a gap drop) and calls `reorderFolder`;
 * the direction it can't travel is hidden at the ends of the list.
 */
export function useFolderReorder(folderId: string): FolderReorderControls {
  const folders = useFolders();
  const { reorderFolder } = useFolderActions();

  const index = folders.findIndex((folder) => folder.id === folderId);

  const reorderTo = (sortOrder: number) => {
    void (async () => {
      try {
        await reorderFolder(folderId, sortOrder);
      } catch {
        // The store already rolled the folder back.
      }
    })();
  };

  return {
    canMoveUp: index > 0,
    canMoveDown: index !== -1 && index < folders.length - 1,
    moveUp: () => {
      // Land between the folder two above (or the top edge) and the folder one above.
      const previous = folders[index - 2]?.sort_order ?? null;
      const next = folders[index - 1]?.sort_order ?? null;
      if (next === null) return;
      reorderTo(computeInsertOrder(previous, next));
    },
    moveDown: () => {
      // Land between the folder one below and the folder two below (or the bottom edge).
      const previous = folders[index + 1]?.sort_order ?? null;
      const next = folders[index + 2]?.sort_order ?? null;
      if (previous === null) return;
      reorderTo(computeInsertOrder(previous, next));
    },
  };
}
