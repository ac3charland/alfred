'use client';

import { useDraggable } from '@dnd-kit/core';
import { FolderOpen, GripVertical } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { FolderCountBadge } from '@/components/tasks/folder-count-badge';
import { FolderDropZone } from '@/components/tasks/folder-drop-zone';
import { FolderGap } from '@/components/tasks/folder-gap';
import { FolderNavMenu } from '@/components/tasks/folder-nav/folder-nav-menu';
import { ViewLink } from '@/components/tasks/view-link';
import { folderDragId } from '@/lib/dnd/reorder-folder';
import { useFolderBadgeCounts } from '@/lib/stores/tasks-store';
import { isTempId } from '@/lib/tree';
import type { Folder } from '@/lib/types';
import { navLinkClass } from '@/lib/ui/nav-link-class';
import { cn } from '@/lib/utils';

import {
  folderDragHandleClass,
  folderIconClass,
  folderRowClass,
  folderRowDraggingClass,
} from '../folder-nav.styles';

interface FolderNavRowProperties {
  folder: Folder;
  /** This row's slot in the rendered list — it owns the gap at its own top edge. */
  index: number;
  /** True for the last row, which also renders the bottom gap (one more gap than rows). */
  isLast: boolean;
  /** The rename form, rendered in place of the row's own contents while this folder is edited. */
  renameField?: React.ReactNode;
  /** Called after the folder link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * One sidebar folder: a link to the folder's view, its attention/overdue badges, the row menu,
 * and both halves of the reorder gesture (ALF-153) — the drop strips at its edges and the grip
 * that lifts it.
 *
 * The ROW is the draggable node while the GRIP is only its activator: dnd-kit sizes the drag
 * ghost from the draggable's box, so hanging the drag off the grip itself would float a
 * 14px-wide sliver instead of the row. The grip sits OUTSIDE the link (the row sensors refuse
 * to start a drag from a link or a button) and is positioned over the folder icon, which fades
 * out beneath it on hover; it is `aria-hidden` and unfocusable on purpose, because the pointer
 * drag is desktop-only and the row menu's "Move up" / "Move down" is the path everywhere else.
 *
 * A folder is also a drop target for tasks (FolderDropZone) — which is why it drags under a
 * PREFIXED id, so the two gestures never share one.
 */
export function FolderNavRow({
  folder,
  index,
  isLast,
  renameField,
  onClose,
  onEdit,
  onDelete,
}: FolderNavRowProperties) {
  const pathname = usePathname();
  const badgeCountsByFolder = useFolderBadgeCounts();
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id: folderDragId(folder.id),
    // A folder that hasn't reconciled yet has no server row to PATCH — its temp id would 404.
    disabled: isTempId(folder.id),
  });

  // exactOptionalPropertyTypes: only spread onClick if onClose is defined, otherwise
  // `(() => void) | undefined` is not assignable to `MouseEventHandler`.
  const closeProperty = onClose ? { onClick: onClose } : {};

  return (
    <FolderDropZone id={folder.id}>
      <div ref={setNodeRef} className={cn(folderRowClass, isDragging && folderRowDraggingClass)}>
        {/* One reorder drop strip at every row's top edge, plus one under the last row —
            together they cover every slot the list has. */}
        <FolderGap index={index} edge="top" />
        {isLast && <FolderGap index={index + 1} edge="bottom" />}

        {renameField ?? (
          <>
            <span
              ref={setActivatorNodeRef}
              aria-hidden
              data-folder-drag-handle=""
              className={folderDragHandleClass}
              {...listeners}
            >
              <GripVertical size={14} />
            </span>

            <ViewLink
              href={`/folders/${folder.id}`}
              className={cn(navLinkClass(pathname === `/folders/${folder.id}`), 'flex-1 min-w-0')}
              {...closeProperty}
            >
              <FolderOpen size={14} className={folderIconClass} />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {/* Attention (amber: high-priority / due today) + overdue (red: past due) counts —
                  right-aligned at the trailing edge so a long name truncates before them
                  (badges are shrink-0); each hidden at zero. Overdue sits last (nearest the
                  edge) as the most urgent. */}
              <FolderCountBadge
                tone="attention"
                count={badgeCountsByFolder[folder.id]?.attention ?? 0}
              />
              <FolderCountBadge
                tone="overdue"
                count={badgeCountsByFolder[folder.id]?.overdue ?? 0}
              />
            </ViewLink>

            <FolderNavMenu
              folderId={folder.id}
              name={folder.name}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </>
        )}
      </div>
    </FolderDropZone>
  );
}
