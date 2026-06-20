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

import { Button } from '@/components/atoms/button';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { TextField } from '@/components/atoms/text-field';
import { TextareaField } from '@/components/atoms/textarea-field';
import { StoryCard } from '@/components/code/story-card';
import { Swimlane } from '@/components/code/swimlane';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import type { BoardEpic } from '@/lib/stores/code-store';
import { useCodeActions } from '@/lib/stores/code-store';
import type { CodeStory, Epic } from '@/lib/types';

/** The phase-appropriate launch handler the board threads to every card. */
export type OpenSessionHandler = (
  story: CodeStory,
  phase: 'refinement' | 'implementation',
) => void | Promise<void>;

/**
 * The epic header's notes-editing area. Notes go through the store's optimistic
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
        <TextareaField
          aria-label="Edit epic notes"
          value={draftNotes}
          onChange={setDraftNotes}
          onSave={saveNotes}
          onCancel={() => {
            setEditingNotes(false);
            setDraftNotes(epic.notes ?? '');
          }}
          placeholder="Epic notes…"
        />
      ) : (
        <InlineEditTrigger
          onClick={() => {
            setDraftNotes(epic.notes ?? '');
            setEditingNotes(true);
          }}
          className="group/notes flex min-w-0 flex-1 items-center gap-1.5 text-sm"
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
        </InlineEditTrigger>
      )}
    </div>
  );
}

interface EpicBlockProperties {
  board: BoardEpic;
  collapsed: boolean;
  onToggleCollapse: () => void;
  showBlocked: boolean;
  onOpenStory: (story: CodeStory) => void;
  onOpenSession: OpenSessionHandler;
}

/** One epic block: a collapsible header + (when open) its row of swimlanes. */
export function EpicBlock({
  board,
  collapsed,
  onToggleCollapse,
  showBlocked,
  onOpenStory,
  onOpenSession,
}: EpicBlockProperties) {
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
  // The shared save state machine (trim → exit → no-op empty/unchanged → rollback on throw)
  // and the select-all-on-edit live in useInlineEdit; the document-mousedown cancel below
  // is board-specific (see the comment on its effect) so it stays here.
  const saveTitle = React.useCallback(
    (next: string) => updateEpic(epic.id, { name: next }),
    [epic.id, updateEpic],
  );
  const titleEdit = useInlineEdit(epic.name, saveTitle);
  const { isEditing: editingTitle, inputRef: titleInputRef, cancel: cancelTitle } = titleEdit;

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
  }, [editingTitle, titleInputRef, cancelTitle]);

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-surface/50">
      <h3 id={headingId} className="m-0 flex items-stretch">
        {editingTitle ? (
          /* When editing title: non-interactive row with the input in place of the name. */
          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            {collapsed ? (
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
            )}
            {epic.archived_at === null ? null : (
              <Archive size={14} className="shrink-0 text-muted-foreground" />
            )}
            <TextField
              ref={titleInputRef}
              aria-label="Edit epic title"
              type="text"
              {...titleEdit.inputProps}
              className="flex-1 py-0.5 font-medium focus-visible:ring-offset-0"
            />
            <CheckboxButton
              aria-label="Confirm title"
              onClick={() => {
                void titleEdit.save();
              }}
              className="h-6 w-6 border-accent-teal bg-accent-teal focus-visible:ring-offset-0"
            >
              <Check size={12} className="text-background" strokeWidth={3} />
            </CheckboxButton>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{epic.ref}</span>
          </div>
        ) : (
          /* Normal state: the collapse toggle button. */
          <DisclosureToggle
            variant="header"
            aria-expanded={!collapsed}
            aria-controls={regionId}
            onClick={onToggleCollapse}
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
          </DisclosureToggle>
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
              <DropdownMenuItem onSelect={titleEdit.begin}>
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

      {/* Notes-editing area. Shown when the epic is expanded. */}
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
