'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import * as React from 'react';

import { INBOX_DROP_ID, resolveFolderDrop } from '@/lib/dnd/drag-to-folder';
import { RowPointerSensor } from '@/lib/dnd/pointer-sensor';
import { resolveReparent } from '@/lib/dnd/reparent';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import { collectSubtree } from '@/lib/tree';

/**
 * Shared state about the in-progress drag, read by every TaskRow so it can light up as a
 * drop target (and bow out when it's the dragged item or one of its descendants).
 */
interface TaskDragState {
  /** The id currently being dragged, or null when nothing is. */
  activeDragId: string | null;
  /** The dragged task's id plus every descendant id — these rows can't be drop targets. */
  draggedSubtreeIds: ReadonlySet<string>;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

const TaskDragContext = React.createContext<TaskDragState>({
  activeDragId: null,
  draggedSubtreeIds: EMPTY_IDS,
});

/** Read the in-progress drag state. Safe outside a provider (unit tests, stories). */
export function useTaskDrag(): TaskDragState {
  return React.useContext(TaskDragContext);
}

/**
 * Drag-and-drop context for the Tasks module. Two kinds of drop happen here, both inside
 * one DndContext so the draggables and every droppable share it:
 *
 * - Drop a task ONTO another task → re-parent it: the dropped task (and its whole subtree)
 *   becomes a child of the target, routed through the optimistic `reparentTask` action.
 * - Drop a task onto a sidebar folder (or Inbox) → file it there via `moveTask`.
 *
 * Every active, reconciled task row is both a drag source and a drop target. A drop shows
 * instantly and reconciles / rolls back on its own (see the data-flow + dnd-kit skills).
 * Wraps the whole module (sidebar + content); a `DragOverlay` shows the dragged title
 * floating under the cursor.
 */
export function TaskDndProvider({ children }: { children: React.ReactNode }) {
  const tasks = useTasks();
  const folders = useFolders();
  const { moveTask, reparentTask } = useTaskActions();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // Drag from anywhere on a row except its buttons/inputs; the 8px threshold keeps a
    // plain click on a control from being read as the start of a drag (see RowPointerSensor).
    useSensor(RowPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeTask = activeId === null ? undefined : tasks.find((item) => item.id === activeId);

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

    // A folder/Inbox target files the subtree; any other id is a task → re-parent.
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
    <TaskDragContext.Provider value={{ activeDragId: activeId, draggedSubtreeIds }}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
        }}
      >
        {children}
        <DragOverlay>
          {activeTask ? (
            <div className="rounded-md border border-accent-teal bg-surface px-3 py-2 text-sm text-foreground shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
              {activeTask.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TaskDragContext.Provider>
  );
}
