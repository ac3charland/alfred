'use client';

import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { StoryCard } from '@/components/code/story-card';
import { Swimlane } from '@/components/code/swimlane';
import type { BoardEpic } from '@/lib/stores/code-store';
import { useCodeActions, useProjectBoard } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The phase-appropriate launch handler the board threads to every card (§11). */
type OpenSessionHandler = (
  story: CodeStory,
  phase: 'refinement' | 'implementation',
) => void | Promise<void>;

export interface BoardProperties {
  /** The project whose board to render (the `/code/[projectId]` route segment). */
  projectId: string;
}

/** A pill toggle (Show archived / blocked filter), styled to match the dense dark UI. */
function ToggleButton({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-100 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        pressed
          ? 'border-accent-teal/60 bg-accent-teal/10 text-accent-teal'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** One epic block: a collapsible header + (when open) its row of swimlanes. */
function EpicBlock({
  board,
  collapsed,
  onToggleCollapse,
  showBlocked,
  onOpenStory,
  onOpenSession,
}: {
  board: BoardEpic;
  collapsed: boolean;
  onToggleCollapse: () => void;
  showBlocked: boolean;
  onOpenStory: (story: CodeStory) => void;
  onOpenSession: OpenSessionHandler;
}) {
  const { epic, lanes, escapeStories } = board;
  const headingId = `epic-${epic.id}-heading`;
  const regionId = `epic-${epic.id}-lanes`;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface/50">
      <h3 id={headingId} className="m-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={regionId}
          onClick={onToggleCollapse}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left transition-colors duration-100 hover:bg-secondary/30 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {collapsed ? (
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
          )}
          {epic.archived_at === null ? null : (
            <Archive size={14} className="shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">{epic.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{epic.ref}</span>
          {/* M4: epic notes-editing + archive/un-archive controls land in this header. */}
        </button>
      </h3>

      {collapsed ? null : (
        <div id={regionId} className="border-t border-border/60 px-2 py-3">
          {/* The six happy-path lanes, horizontally scrollable to fit the dense layout. */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lanes.map((lane) => (
              <Swimlane
                key={lane.state}
                lane={lane}
                onOpenStory={onOpenStory}
                onOpenSession={onOpenSession}
              />
            ))}
          </div>

          {/* Off-track stories (blocked / abandoned): revealed only by the filter toggle. */}
          {showBlocked && escapeStories.length > 0 ? (
            <div className="mt-3 border-t border-border/60 pt-3">
              <h4 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Off track
              </h4>
              <div className="grid grid-cols-1 gap-2 px-2 sm:grid-cols-2 lg:grid-cols-3">
                {escapeStories.map((story) => (
                  <StoryCard key={story.item_id} story={story} onOpen={onOpenStory} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * The Code board pane for one project (§9.2): the project's epics **stacked vertically,
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
 * Swimlanes are read-only here. Clicking a card calls `onOpenStory` — a placeholder this
 * milestone; the detail modal (§10) hangs off it in M6.
 */
export function Board({ projectId }: BoardProperties) {
  const { project, activeEpics, archivedEpics } = useProjectBoard(projectId);
  const { openClaudeSession } = useCodeActions();

  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [showArchived, setShowArchived] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);

  const toggleCollapse = React.useCallback((epicId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(epicId)) next.add(epicId);
      return next;
    });
  }, []);

  // Placeholder until M6 — the detail modal opens from here (§10). No-op for now so the
  // card is already an activatable control and e2e/RTL can assert the click target exists.
  const handleOpenStory = React.useCallback((_story: CodeStory) => {
    // M6: open the story detail modal.
  }, []);

  // The §11 human launch: await the state write then open the prefilled tab (the store
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

  if (project === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">This project could not be found.</p>
      </div>
    );
  }

  const visibleEpics = showArchived ? [...activeEpics, ...archivedEpics] : activeEpics;
  const hasAnyEpic = activeEpics.length > 0 || archivedEpics.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-2xl text-foreground">{project.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">{project.key}</span>
        </div>
        <div className="flex items-center gap-2">
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
              showBlocked={showBlocked}
              onOpenStory={handleOpenStory}
              onOpenSession={handleOpenSession}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No epics yet. Send a story to this project from the inbox to start its first epic.
          </p>
        </div>
      )}
    </div>
  );
}
