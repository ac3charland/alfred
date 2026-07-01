'use client';

import { Archive, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { EpicBlock, type OpenSessionHandler } from '@/components/code/board/epic-block';
import { NewEpicDialog } from '@/components/code/new-epic-dialog';
import { StatusFilterMenu } from '@/components/code/status-filter-menu';
import { StoryDetailModal } from '@/components/code/story-detail-modal';
import { useStatusFilter } from '@/lib/hooks/use-status-filter';
import { HAPPY_PATH_STATES, useCodeActions, useProjectBoard } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

export interface BoardProperties {
  /** The project whose board to render (the `/code/[projectId]` route segment). */
  projectId: string;
}

/**
 * The Code board pane for one project: the project's epics **stacked vertically,
 * each collapsible**; an expanded epic shows a **horizontal row of swimlanes** for the six
 * happy-path states, with **stories as cards** (ref + title) in their state's lane.
 *
 * - **Per-epic collapse** is tracked board-locally (a Set of collapsed epic ids) so
 *   collapsing one epic leaves the others open — ephemeral session UI, like the tasks
 *   ExpansionProvider (not DB-backed).
 * - **Archived epics** are hidden behind a *Show archived* toggle (a client read filter).
 * - **blocked/abandoned** stories never get a column; a *Show blocked* toggle reveals them
 *   per-epic as off-track cards with their distinct treatment.
 *
 * Swimlanes are read-only here. Clicking a card calls `onOpenStory` — a placeholder for
 * now; the detail modal hangs off it.
 */
export function Board({ projectId }: BoardProperties) {
  const { project, activeEpics, archivedEpics } = useProjectBoard(projectId);
  const { openClaudeSession, createEpic } = useCodeActions();
  // A `?story=<ref>` deep-link (e.g. from a Backlog row) opens that story's modal — see below.
  const storyParam = useSearchParams().get('story');

  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [showArchived, setShowArchived] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);
  // "Filter by status": hides unchecked happy-path lanes across every epic. Defaults to all six
  // shown, so an untouched board is identical to before. The off-track (blocked/abandoned) cards
  // stay governed by the separate Show-blocked toggle — they are not lanes.
  const {
    statuses: visibleStates,
    toggle: toggleState,
    isFiltering,
  } = useStatusFilter(HAPPY_PATH_STATES);
  const [newEpicOpen, setNewEpicOpen] = React.useState(false);
  // The open story for the detail modal, tracked by item_id so the modal always
  // re-reads the latest row from the store (e.g. after a manual transition reshuffles it).
  const [openStoryId, setOpenStoryId] = React.useState<string | null>(null);
  // The last `?story=` param we acted on, so the resolve-during-render below fires once per
  // param change instead of every render (the react-blessed alternative to a setState effect).
  const [seenStoryParam, setSeenStoryParam] = React.useState<string | null>(null);

  const toggleCollapse = React.useCallback((epicId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(epicId)) next.add(epicId);
      return next;
    });
  }, []);

  const collapseAll = React.useCallback((epicIds: readonly string[]) => {
    setCollapsed((current) => {
      const next = new Set(current);
      for (const id of epicIds) next.add(id);
      return next;
    });
  }, []);

  const openAll = React.useCallback(() => {
    setCollapsed(new Set());
  }, []);

  // Open the detail modal for the clicked card. Tracks the item_id, not the row, so
  // the modal reflects live store updates rather than a stale snapshot.
  const handleOpenStory = React.useCallback((story: CodeStory) => {
    setOpenStoryId(story.item_id);
  }, []);

  // The human launch: await the state write then open the prefilled tab (the store
  // action owns the await-then-open; the card owns the in-flight spinner). A failed write
  // rejects — swallow it here so an unhandled rejection doesn't surface; the card re-enables.
  const handleOpenSession = React.useCallback<OpenSessionHandler>(
    async (story, phase) => {
      // A story showing a launch button always has a real ref (the view's inner-join
      // guarantee; the row type is nullable only because it's a view) — guard for the type.
      if (story.ref === null) return;
      await openClaudeSession(story.ref, phase);
    },
    [openClaudeSession],
  );

  // Resolve the open story from the current board so the modal reflects live store state
  // (every epic's lanes + escape bucket cover all of this project's stories).
  const allStories = [...activeEpics, ...archivedEpics].flatMap((board) => [
    ...board.lanes.flatMap((lane) => lane.stories),
    ...board.escapeStories,
  ]);

  // Deep-link seam (ALF-35): a `?story=<ref>` opens that story's modal. Resolve the ref against
  // this board and open it; if the ref isn't in this project, ignore it. Adjusting state DURING
  // render (keyed on the param) fires this once per param change, not every render.
  if (storyParam !== seenStoryParam) {
    setSeenStoryParam(storyParam);
    if (storyParam !== null) {
      const match = allStories.find((s) => s.ref === storyParam);
      if (match !== undefined && match.item_id !== null) setOpenStoryId(match.item_id);
    }
  }

  if (project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">This project could not be found.</p>
      </div>
    );
  }

  const visibleEpics = showArchived ? [...activeEpics, ...archivedEpics] : activeEpics;
  const hasAnyEpic = activeEpics.length > 0 || archivedEpics.length > 0;
  const allCollapsed =
    visibleEpics.length > 0 && visibleEpics.every((b) => collapsed.has(b.epic.id));

  const openStory = openStoryId === null ? null : allStories.find((s) => s.item_id === openStoryId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-2xl text-foreground">{project.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">{project.key}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNewEpicOpen(true);
            }}
          >
            <Plus size={14} />
            Create epic
          </Button>
          {visibleEpics.length > 0 ? (
            <ToggleButton
              pressed={false}
              onToggle={() => {
                if (allCollapsed) {
                  openAll();
                } else {
                  collapseAll(visibleEpics.map((b) => b.epic.id));
                }
              }}
            >
              {allCollapsed ? 'Open all' : 'Collapse all'}
            </ToggleButton>
          ) : null}
          <StatusFilterMenu
            options={HAPPY_PATH_STATES}
            selected={visibleStates}
            onToggle={toggleState}
            isFiltering={isFiltering}
          />
          <ToggleButton
            pressed={showBlocked}
            onToggle={() => {
              setShowBlocked((on) => !on);
            }}
          >
            Show blocked
          </ToggleButton>
          {archivedEpics.length > 0 ? (
            <ToggleButton
              pressed={showArchived}
              onToggle={() => {
                setShowArchived((on) => !on);
              }}
            >
              <Archive size={12} />
              Show archived
            </ToggleButton>
          ) : null}
        </div>
      </div>

      {hasAnyEpic ? (
        <div className="flex flex-col gap-3">
          {visibleEpics.map((board) => (
            <EpicBlock
              key={board.epic.id}
              board={board}
              collapsed={collapsed.has(board.epic.id)}
              onToggleCollapse={() => {
                toggleCollapse(board.epic.id);
              }}
              visibleStates={visibleStates}
              showBlocked={showBlocked}
              onOpenStory={handleOpenStory}
              onOpenSession={handleOpenSession}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No epics yet. Create your first epic above, or send a story to this project from the
            inbox.
          </p>
        </div>
      )}

      {/* Create a new epic directly on the board (mirrors the gate's "+ New epic"): the
          store inserts it optimistically, so the board picks it up with no refetch. */}
      <NewEpicDialog
        open={newEpicOpen}
        onOpenChange={setNewEpicOpen}
        projectName={project.name}
        onCreateEpic={(name) => createEpic(projectId, name)}
        onCreated={() => {
          // The store already inserted the epic optimistically; nothing to select here.
        }}
      />

      {/* The story detail modal: opens on a card click; reads the latest row from the
          store by item_id; reuses the board's launch handler for its primary action. */}
      <StoryDetailModal
        story={openStory ?? null}
        open={openStory !== null && openStory !== undefined}
        onOpenChange={(next) => {
          if (!next) {
            setOpenStoryId(null);
            // Clear a `?story=` deep-link so closing doesn't re-open on the next render and the
            // URL stays tidy. Replace (not push) — closing the modal shouldn't add history.
            if (storyParam !== null) {
              globalThis.history.replaceState(null, '', `/code/${projectId}`);
            }
          }
        }}
        onOpenSession={handleOpenSession}
      />
    </div>
  );
}
