'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import * as React from 'react';

import { type DraggedStory, resolveLaneDrop } from '@/lib/dnd/move-story-lane';
import { RowMouseSensor, RowTouchSensor } from '@/lib/dnd/pointer-sensor';
import { useCodeActions, useCodeStories } from '@/lib/stores/code-store';

/** What the lanes need to know about the drag in flight so they can offer themselves as targets. */
interface BoardDragState {
  /**
   * The story being dragged, or `null` when nothing is. Each lane runs it through the same
   * `resolveLaneDrop` the drop does, so the highlight can never promise a move the drop refuses.
   */
  activeStory: DraggedStory | null;
}

const BoardDragContext = React.createContext<BoardDragState>({ activeStory: null });

/** Read the in-progress board drag. Safe outside a provider (unit tests, stories). */
export function useBoardDrag(): BoardDragState {
  return React.useContext(BoardDragContext);
}

/**
 * Drag-and-drop context for the Code board: drag a story card onto another swimlane to move it
 * to that state (ALF-155). The drop routes through the SAME optimistic `updateCodeState` the
 * detail modal's status menu uses, so the card lands in its new lane instantly and reconciles /
 * rolls back on its own (see the data-flow + dnd-kit skills).
 *
 * The gesture is deliberately state-only: a lane belonging to a different epic is not a target,
 * so a drag can never re-home a story (that stays the detail modal's "Move to epic"). It is also
 * pointer-only — arrowing between six lanes would be worse than the status menu, which remains
 * the keyboard path, exactly as the sidebar's folder reorder leans on its row menu.
 *
 * The Tasks module has its own `DndContext` one level up (it wraps the whole shell). Nesting is
 * what keeps the two apart: a story card registers with the NEAREST context, so board drags and
 * task drags never see each other's draggables or droppables.
 */
export function BoardDndProvider({ children }: { children: React.ReactNode }) {
  const stories = useCodeStories();
  const { updateCodeState } = useCodeActions();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // Mouse: lift from anywhere on the card except its launch chips; the 8px threshold keeps a
    // plain click (which opens the detail modal) from being read as the start of a drag.
    useSensor(RowMouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: hold still for ~250ms to lift, so a swipe scrolls the lane row instead of dragging.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const activeStory = stories.find((story) => story.item_id === activeId) ?? null;

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    const dragged = stories.find((story) => story.item_id === String(active.id));
    if (dragged === undefined) return;
    const move = resolveLaneDrop(dragged, over === null ? null : String(over.id));
    if (move === null) return;
    void (async () => {
      try {
        // Leaving `blocked` must clear the reason with the same write — the PATCH route only
        // forwards `blocked_reason` when the body carries the key.
        await updateCodeState(
          move.ref,
          move.state,
          move.clearsBlockedReason ? { blocked_reason: null } : undefined,
        );
      } catch {
        // The optimistic store already rolled the card back into its old lane and toasted.
      }
    })();
  };

  return (
    <BoardDragContext.Provider value={{ activeStory }}>
      <DndContext
        sensors={sensors}
        // Lanes are large zones rather than a sortable axis, so the pointer's position decides
        // the target (`closestCenter` would snap to a lane the pointer has already left).
        collisionDetection={pointerWithin}
        onDragStart={(event: DragStartEvent) => {
          setActiveId(String(event.active.id));
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
        }}
      >
        {children}
        <DragOverlay>
          {activeStory === null ? null : (
            // A presentational ghost, never the draggable card itself (two mounts would share
            // one draggable id). Mirrors the card's ref-over-title layout in the translucent,
            // neutral-outlined treatment the task ghost uses, so the teal lane highlight stays
            // the only drop signal.
            <div className="w-60 rounded-lg bg-surface/70 px-3 py-2 ring-1 ring-inset ring-border backdrop-blur-sm shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
              <span className="font-mono text-xs font-medium text-accent-teal">
                {activeStory.ref}
              </span>
              <span className="mt-1 line-clamp-2 block text-sm text-foreground">
                {activeStory.title}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </BoardDragContext.Provider>
  );
}
