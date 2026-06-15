'use client';

import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import * as React from 'react';

import { StoryCard } from '@/components/code/story-card';
import { StoryDetailModal } from '@/components/code/story-detail-modal';
import { Swimlane } from '@/components/code/swimlane';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BoardEpic } from '@/lib/stores/code-store';
import { useCodeActions, useProjectBoard } from '@/lib/stores/code-store';
import type { CodeStory, Epic } from '@/lib/types';
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

/**
 * The epic header's notes-editing area (§9.2). Notes go through the store's optimistic
 * `updateEpic`. Sits OUTSIDE the collapse toggle button (no nested interactive elements).
 */
function EpicHeaderActions({ epic }: { epic: Epic }) {
  const { updateEpic } = useCodeActions();
  const [editingNotes, setEditingNotes] = React.useState(false);
  const [draftNotes, setDraftNotes] = React.useState(epic.notes ?? '');

  const saveNotes = async () => {
    const next = draftNotes.trim();
    setEditingNotes(false);
    if (next === (epic.notes ?? '')) return;
    try {
      await updateEpic(epic.id, { notes: next === '' ? null : next });
    } catch {
      setDraftNotes(epic.notes ?? '');
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border/40 px-4 pb-3">
      {editingNotes ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Edit epic notes"
            value={draftNotes}
            onChange={(e) => {
              setDraftNotes(e.target.value);
            }}
            rows={2}
            placeholder="Epic notes…"
            className="w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void saveNotes();
              }}
              className="text-accent-teal hover:bg-accent-teal/10"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingNotes(false);
                setDraftNotes(epic.notes ?? '');
              }}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraftNotes(epic.notes ?? '');
            setEditingNotes(true);
          }}
          className="group/notes flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          {epic.notes === null || epic.notes === '' ? (
            <span className="text-muted-foreground hover:text-foreground">Add epic notes…</span>
          ) : (
            <span className="truncate whitespace-pre-wrap text-muted-foreground">{epic.notes}</span>
          )}
          <Pencil
            size={12}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/notes:opacity-100 motion-reduce:transition-none"
          />
        </button>
      )}
    </div>
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
  const { updateEpic } = useCodeActions();
  const headingId = `epic-${epic.id}-heading`;
  const regionId = `epic-${epic.id}-lanes`;
  const archived = epic.archived_at !== null;
  const [pending, setPending] = React.useState(false);

  const toggleArchive = async () => {
    setPending(true);
    try {
      await updateEpic(epic.id, { archived_at: archived ? null : new Date().toISOString() });
    } catch {
      // The store rolled the change back.
    } finally {
      setPending(false);
    }
  };

  // Inline title editing: when active, the header toggle becomes a div with an input.
  const currentTitle = epic.name;
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(currentTitle);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  // Auto-focus + select-all when editing starts.
  React.useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const startEditTitle = React.useCallback(() => {
    setDraftTitle(currentTitle);
    setEditingTitle(true);
  }, [currentTitle]);

  const cancelTitle = React.useCallback(() => {
    setEditingTitle(false);
    setDraftTitle(currentTitle);
  }, [currentTitle]);

  const saveTitle = React.useCallback(async () => {
    const next = draftTitle.trim();
    setEditingTitle(false);
    if (next === '' || next === currentTitle) {
      setDraftTitle(currentTitle);
      return;
    }
    try {
      await updateEpic(epic.id, { name: next });
    } catch {
      // The store rolled the change back; reset to the current (rolled-back) name.
      setDraftTitle(currentTitle);
    }
  }, [draftTitle, currentTitle, epic.id, updateEpic]);

  // Cancel title edit when the user clicks outside the input (mousedown so it fires before
  // focus moves). Using mousedown instead of blur avoids false cancels from programmatic
  // focus restoration (e.g. Radix restoring focus to the dropdown trigger after close).
  React.useEffect(() => {
    if (!editingTitle) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (titleInputRef.current && !titleInputRef.current.contains(e.target as Node)) {
        cancelTitle();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [editingTitle, cancelTitle]);

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface/50">
      <h3 id={headingId} className="m-0 flex items-stretch">
        {editingTitle ? (
          /* When editing title: non-interactive row with the input in place of the name. */
          /* TODO: investigate consolidating this inline-title-edit pattern (input + check
             button + Escape/click-outside cancel) with story-detail-modal's EditableTitle
             and folder-nav's rename input into a single shared EditableTextField atom. */
          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            {collapsed ? (
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
            )}
            {epic.archived_at === null ? null : (
              <Archive size={14} className="shrink-0 text-muted-foreground" />
            )}
            <input
              ref={titleInputRef}
              aria-label="Edit epic title"
              type="text"
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTitle();
                if (e.key === 'Escape') cancelTitle();
              }}
              className="flex-1 rounded-sm border border-border bg-input px-2 py-0.5 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
            />
            <button
              type="button"
              aria-label="Confirm title"
              onClick={() => {
                void saveTitle();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
            >
              <Check size={12} className="text-background" strokeWidth={3} />
            </button>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{epic.ref}</span>
          </div>
        ) : (
          /* Normal state: the collapse toggle button. */
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={regionId}
            onClick={onToggleCollapse}
            className="flex flex-1 items-center gap-2 rounded-xl px-4 py-3 text-left transition-colors duration-100 hover:bg-secondary/30 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
          </button>
        )}

        {/* 3-dot actions menu in the title corner: Edit title + Archive/Unarchive. */}
        {editingTitle ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Epic actions"
                className="mr-2 h-7 w-7 shrink-0 self-center text-muted-foreground"
              >
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={startEditTitle}>
                <Pencil size={13} />
                Edit title
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => {
                  void toggleArchive();
                }}
              >
                {archived ? (
                  <>
                    <ArchiveRestore size={13} />
                    Unarchive
                  </>
                ) : (
                  <>
                    <Archive size={13} />
                    Archive
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </h3>

      {/* Notes-editing area (§9.2). Shown when the epic is expanded. */}
      {collapsed ? null : <EpicHeaderActions epic={epic} />}

      {collapsed ? null : (
        <div id={regionId} className="px-2 py-3">
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
  // The open story for the detail modal (§10), tracked by item_id so the modal always
  // re-reads the latest row from the store (e.g. after a manual transition reshuffles it).
  const [openStoryId, setOpenStoryId] = React.useState<string | null>(null);

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

  // Open the detail modal for the clicked card (§10). Tracks the item_id, not the row, so
  // the modal reflects live store updates rather than a stale snapshot.
  const handleOpenStory = React.useCallback((story: CodeStory) => {
    setOpenStoryId(story.item_id);
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
  const allCollapsed =
    visibleEpics.length > 0 && visibleEpics.every((b) => collapsed.has(b.epic.id));

  // Resolve the open story from the current board so the modal reflects live store state
  // (every epic's lanes + escape bucket cover all of this project's stories).
  const allStories = [...activeEpics, ...archivedEpics].flatMap((board) => [
    ...board.lanes.flatMap((lane) => lane.stories),
    ...board.escapeStories,
  ]);
  const openStory = openStoryId === null ? null : allStories.find((s) => s.item_id === openStoryId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-2xl text-foreground">{project.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">{project.key}</span>
        </div>
        <div className="flex items-center gap-2">
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

      {/* The story detail modal (§10): opens on a card click; reads the latest row from the
          store by item_id; reuses the board's §11 launch handler for its primary action. */}
      <StoryDetailModal
        story={openStory ?? null}
        open={openStory !== null && openStory !== undefined}
        onOpenChange={(next) => {
          if (!next) setOpenStoryId(null);
        }}
        onOpenSession={handleOpenSession}
      />
    </div>
  );
}
