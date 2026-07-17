'use client';

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import * as React from 'react';

import { INBOX_DROP_ID, resolveFolderDrop } from '@/lib/dnd/drag-to-folder';
import { RowKeyboardSensor } from '@/lib/dnd/keyboard-sensor';
import { RowMouseSensor, RowTouchSensor } from '@/lib/dnd/pointer-sensor';
import { isPromoteZone, resolvePromoteToRoot } from '@/lib/dnd/promote-to-root';
import { isReorderGap, parseReorderGapId, resolveReorder } from '@/lib/dnd/reorder-subtask';
import { resolveReparent } from '@/lib/dnd/reparent';
import { stableSorted } from '@/lib/sort';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import { collectSubtree, getItemDepth, isTempId } from '@/lib/tree';

/**
 * Shared state about the in-progress drag, read by every TaskRow so it can light up as a
 * drop target (and bow out when it's the dragged item or one of its descendants).
 */
interface TaskDragState {
  /** The id currently being dragged, or null when nothing is. */
  activeDragId: string | null;
  /** The dragged task's id plus every descendant id — these rows can't be drop targets. */
  draggedSubtreeIds: ReadonlySet<string>;
  /** True while the dragged task is itself a child — only then can it be promoted to root. */
  activeDragIsChild: boolean;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

const TaskDragContext = React.createContext<TaskDragState>({
  activeDragId: null,
  draggedSubtreeIds: EMPTY_IDS,
  activeDragIsChild: false,
});

/** Read the in-progress drag state. Safe outside a provider (unit tests, stories). */
export function useTaskDrag(): TaskDragState {
  return React.useContext(TaskDragContext);
}

/**
 * `pointerWithin` variant that excludes droppables whose DOM nodes live inside an `inert`
 * container (i.e. a closed AnimatedHeightCollapse). Without this filter, collapsed subtask
 * rows have non-zero getBoundingClientRect() values that overlap visible rows — their phantom
 * bounding boxes win the distance sort inside `pointerWithin` when the pointer lands near a
 * row boundary, causing the drag to highlight the wrong (invisible) target.
 *
 * Filtering at collision-detection time (rather than via the `measuring` prop) is reliable
 * because it reads the live DOM on every pointer move — no caching or async re-measurement
 * windows can let a stale rect slip through.
 */
const pointerWithinVisible: CollisionDetection = (args) => {
  const visibleContainers = args.droppableContainers.filter((container) => {
    const node = container.node.current;
    if (!node) return true;
    let ancestor: Element | null = node.parentElement;
    while (ancestor) {
      if (ancestor.hasAttribute('inert')) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  // Test the reorder-gap strips FIRST (ALF-117): a gap straddles a row boundary, so a hover near
  // the edge overlaps both the gap and the row body. Preferring the gap makes a boundary hover
  // read as "reorder into this slot" rather than "re-parent onto this row"; the ~24px of row body
  // left uncovered between gaps still resolves to the row for re-parenting. (Gaps are `disabled`
  // unless a subtask is being dragged, so they don't intercept a root drag or a folder drop.)
  const gapContainers = visibleContainers.filter((container) => isReorderGap(String(container.id)));
  const gapHits = pointerWithin({ ...args, droppableContainers: gapContainers });
  if (gapHits.length > 0) return gapHits;
  return pointerWithin({ ...args, droppableContainers: visibleContainers });
};

/**
 * Drag-and-drop context for the Tasks module. Two kinds of drop happen here, both inside
 * one DndContext so the draggables and every droppable share it:
 *
 * - Drop a task ONTO another task → re-parent it: the dropped task (and its whole subtree)
 *   becomes a child of the target, routed through the optimistic `reparentTask` action.
 * - Drop a task onto a sidebar folder (or Inbox) → file it there via `moveTask`.
 * - Drop a child task onto the list's top/bottom edge → pull it out to a top-level task
 *   (`reparentTask(id, null)`).
 *
 * Every active, reconciled task row is both a drag source and a drop target. A drop shows
 * instantly and reconciles / rolls back on its own (see the data-flow + dnd-kit skills).
 * Wraps the whole module (sidebar + content); a `DragOverlay` shows the dragged title
 * floating under the cursor.
 */
export function TaskDndProvider({ children }: { children: React.ReactNode }) {
  const tasks = useTasks();
  const folders = useFolders();
  const { moveTask, reparentTask, reorderSubtask } = useTaskActions();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // Mouse: drag from anywhere on a row except its buttons/inputs; the 8px threshold keeps a
    // plain click on a control from being read as the start of a drag (see RowMouseSensor).
    useSensor(RowMouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: hold the row still for ~250ms to lift it. A plain swipe moves the finger past the
    // 5px tolerance within that window, so no drag starts and the browser scrolls the list —
    // without the split, touch inherited the mouse's distance threshold and every scroll swipe
    // was mis-read as a drag (see RowTouchSensor).
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // RowKeyboardSensor, like the pointer sensors, refuses to lift from the row's buttons or
    // inline edit input — so pressing Space while editing a title types a space instead of
    // starting a phantom keyboard drag that collapses the editor (see the dnd-kit skill).
    useSensor(RowKeyboardSensor),
  );

  const activeTask = activeId === null ? undefined : tasks.find((item) => item.id === activeId);
  // A child can be pulled out to the top level; a task that's already a root can't.
  const activeDragIsChild = activeTask !== undefined && activeTask.parent_id !== null;

  // Depth of the dragged task — drives the DragOverlay indent so title text aligns with the row.
  const activeDragDepth = React.useMemo(
    () => (activeId === null ? 0 : getItemDepth(tasks, activeId)),
    [activeId, tasks],
  );

  // The dragged item + its descendants — the rows that must NOT accept the current drag.
  const draggedSubtreeIds = React.useMemo<ReadonlySet<string>>(() => {
    if (activeId === null) return EMPTY_IDS;
    return new Set(collectSubtree(tasks, activeId).map((item) => item.id));
  }, [activeId, tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over === null) return;
    const dragged = tasks.find((item) => item.id === active.id);
    if (dragged === undefined) return;
    const draggedId = String(active.id);
    const overId = String(over.id);

    // A reorder-gap strip places the dragged subtask at that slot (ALF-117) — tested before the
    // folder / promote / reparent branches so a boundary hover reorders rather than re-parents.
    if (isReorderGap(overId)) {
      const gap = parseReorderGapId(overId);
      if (gap === null) return;
      const subtreeIds = new Set(collectSubtree(tasks, draggedId).map((item) => item.id));
      // The gap parent's active children in display order (sort_order asc) — the rendered
      // siblings. resolveReorder wants them EXCLUDING the dragged row, and an insertIndex in that
      // excluded space; the rendered gap index counts the dragged row, so drop one when the gap
      // sits below the dragged row's current position.
      const fullSiblings = stableSorted(
        tasks.filter((item) => item.parent_id === gap.parentId && item.status === 'active'),
        (a, b) => a.sort_order - b.sort_order,
      );
      const draggedPos = fullSiblings.findIndex((item) => item.id === draggedId);
      const orderedSiblings = fullSiblings
        .filter((item) => item.id !== draggedId)
        .map((item) => ({ id: item.id, sortOrder: item.sort_order }));
      const insertIndex = draggedPos !== -1 && gap.index > draggedPos ? gap.index - 1 : gap.index;
      const reorder = resolveReorder({
        draggedId,
        draggedParentId: dragged.parent_id,
        draggedSortOrder: dragged.sort_order,
        gapParentId: gap.parentId,
        orderedSiblings,
        insertIndex,
        subtreeIds,
      });
      if (reorder === null) return;
      void (async () => {
        try {
          await reorderSubtask(reorder.itemId, {
            parentId: reorder.parentId,
            sortOrder: reorder.sortOrder,
          });
        } catch {
          // The optimistic store already rolled the row(s) back.
        }
      })();
      return;
    }

    // A folder/Inbox target files the subtree; a list edge promotes the child to a
    // top-level task; any other id is a task → re-parent.
    const isFolderTarget = overId === INBOX_DROP_ID || folders.some((f) => f.id === overId);
    if (isFolderTarget) {
      const move = resolveFolderDrop(draggedId, overId, dragged.folder_id);
      if (move === null) return;
      void (async () => {
        try {
          await moveTask(move.itemId, move.folderId);
        } catch {
          // The optimistic store already rolled the subtree back.
        }
      })();
      return;
    }

    if (isPromoteZone(overId)) {
      const promotion = resolvePromoteToRoot(draggedId, overId, dragged.parent_id);
      if (promotion === null) return;
      void (async () => {
        try {
          await reparentTask(promotion.itemId, null);
        } catch {
          // The optimistic store already rolled the subtree back.
        }
      })();
      return;
    }

    // Every row is a registered droppable now (so `over` is never a stale target), which
    // means `over` may be a row that can't actually receive a child: a completed or temp
    // (unreconciled) task. Bail on those before resolving the re-parent.
    const target = tasks.find((item) => item.id === overId);
    if (target === undefined || target.status === 'completed' || isTempId(target.id)) return;

    const subtreeIds = new Set(collectSubtree(tasks, draggedId).map((item) => item.id));
    const reparent = resolveReparent(draggedId, overId, dragged.parent_id, subtreeIds);
    if (reparent === null) return;
    void (async () => {
      try {
        await reparentTask(reparent.itemId, reparent.newParentId);
      } catch {
        // The optimistic store already rolled the subtree back.
      }
    })();
  };

  return (
    <TaskDragContext.Provider
      value={{ activeDragId: activeId, draggedSubtreeIds, activeDragIsChild }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithinVisible}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
        }}
      >
        {children}
        <DragOverlay>
          {activeTask ? (
            // Mirror the row's layout so title text aligns with the dimmed in-place row, eliminating the jump on drag cancel.
            <div
              className="flex items-center gap-2 rounded-sm bg-surface py-2 pr-2 text-sm ring-1 ring-accent-teal shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]"
              style={{ paddingLeft: `${String(activeDragDepth * 1.25 + 0.75)}rem` }}
            >
              <div aria-hidden="true" className="h-5 w-5 shrink-0" />
              <div aria-hidden="true" className="h-4 w-4 shrink-0 rounded border border-border" />
              <span className="min-w-0 flex-1 truncate text-foreground">{activeTask.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TaskDragContext.Provider>
  );
}
