'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  MoreHorizontal,
  Plus,
  SendHorizontal,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import type { RowDispatchAction } from '@/lib/tasks/dispatch';
import type { Folder } from '@/lib/types';

/** Why Classify as… is disabled on a subtask or a row with subtasks (the shape gate). */
const CLASSIFY_DISABLED_HINT = 'Only a top-level item with no subtasks can change type';

interface TaskRowMenuProperties {
  /**
   * True when the row's type may change: a top-level row with no subtasks. Correcting a type is
   * an ordinary act now, so Classify as… renders for every row — disabled with a hint when the
   * shape forbids it (a parent's flip would strand its children's family; see useTaskRowFlags).
   */
  canChangeType: boolean;
  /** True for a code row (its subtask affordance is "Add story"). */
  isCode: boolean;
  /** May host subtasks (any task, or a code root) — offers the mobile Add subtask/story item. */
  canAddSubtask: boolean;
  /**
   * What Dispatch would do on this row, or `null` when the row offers no Dispatch at all — a
   * subtask (residency travels with its root), a row that has already left the Inbox, or a
   * history row in the Completed view.
   */
  dispatch: RowDispatchAction | null;
  /** The folders the row can be moved into (the "Move to…" submenu; hidden when empty). */
  folders: readonly Folder[];
  /**
   * True once the row has left the Inbox — only then does "Move to…" render. Inside the Inbox
   * a folder is a LABEL you set on the chip and act on with Dispatch, not a move.
   */
  canMoveToFolder: boolean;
  /** True for an active subtask not already at the top of its sibling group (offers "Move up"). */
  canMoveUp: boolean;
  /** True for an active subtask not already at the bottom of its sibling group (offers "Move down"). */
  canMoveDown: boolean;
  /** Reorder the subtask up one slot among its siblings (ALF-117). */
  onMoveUp: () => void;
  /** Reorder the subtask down one slot among its siblings (ALF-117). */
  onMoveDown: () => void;
  /** Open the row's inline add-subtask field (the leading, mobile-only entry — see ALF-118). */
  onAddSubtask: () => void;
  /** Open the row's inline detail panel (the primary, leading entry). */
  onOpenDetails: () => void;
  onClassify: (itemType: 'task' | 'code') => void;
  /**
   * Send this row where its labels already say it goes (ALF-185). The row picks the path from
   * the same `dispatch` action rendered here: the residency write / factory gate, or the epic
   * conversion for a code parent.
   */
  onDispatch: () => void;
  onMoveToFolder: (targetFolderId?: string) => void;
  onDelete: () => void;
}

/**
 * The task row's "More actions" dropdown. **"Open details" leads** (teal, the primary action —
 * it's how the detail is reached now), then a divider. On mobile a row that may host subtasks
 * shows **"Add subtask"** (or **"Add story"** on a code root) just below that divider — the
 * inline "+" button is desktop-only, so the affordance collapses into this menu below `md`
 * (ALF-118); the item is `md:hidden` so desktop never doubles up. Then the triage pair, in the
 * order the Inbox is worked: **Classify as…** sets the labels, **Dispatch** acts on them —
 * one entry for every destination, disabled with the blocker as its hint until the labels are
 * complete (ALF-185 folded "Send to Code module" and the two Convert entries into it). A row
 * that has already left the Inbox offers **Move to…** instead, the only place a folder is
 * still a move rather than a label. Finally a destructive Delete below a divider. Every
 * conditional stays encapsulated here so the row body composes the menu without restating them.
 */
export function TaskRowMenu({
  canChangeType,
  isCode,
  canAddSubtask,
  dispatch,
  folders,
  canMoveToFolder,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onAddSubtask,
  onOpenDetails,
  onClassify,
  onDispatch,
  onMoveToFolder,
  onDelete,
}: TaskRowMenuProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="md" aria-label="More actions">
          {/* Enlarged glyph on mobile (18px) to match the bigger add-subtask "+"; today's 14px
            at md+. */}
          <MoreHorizontal size={14} className="h-[18px] w-[18px] md:h-3.5 md:w-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Open details — the primary action, highlighted teal. Opens the inline detail panel
            with the auto-saving Due / Repeat / Priority chips and the notes editor. */}
        <DropdownMenuItem
          onSelect={onOpenDetails}
          className="font-semibold text-accent-teal focus:text-accent-teal data-[highlighted]:bg-accent-teal/10"
        >
          Open details
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Add subtask / Add story — mobile-only (`md:hidden`): the inline "+" button is hidden
            below `md`, so its affordance lives here, below the divider under "Open details"
            (ALF-118). Rows that may host subtasks only — a code CHILD never shows it (1-deep). */}
        {canAddSubtask && (
          <DropdownMenuItem className="md:hidden" onSelect={onAddSubtask}>
            <Plus size={16} className="text-muted-foreground" />
            {isCode ? 'Add story' : 'Add subtask'}
          </DropdownMenuItem>
        )}

        {/* Move up / Move down — reorder an active subtask among its siblings (ALF-117). The
            deterministic, keyboard/screen-reader-friendly path (the gap-drop gesture is
            pointer-only). Each item is hidden at the end of the group it can't move toward, and
            the whole group is absent on roots and in the Completed view (both flags false). */}
        {(canMoveUp || canMoveDown) && (
          <>
            {canMoveUp && (
              <DropdownMenuItem onSelect={onMoveUp}>
                <ArrowUp size={16} className="text-muted-foreground" />
                Move up
              </DropdownMenuItem>
            )}
            {canMoveDown && (
              <DropdownMenuItem onSelect={onMoveDown}>
                <ArrowDown size={16} className="text-muted-foreground" />
                Move down
              </DropdownMenuItem>
            )}
          </>
        )}

        {/* Classify as ▸ — sets or corrects the row's type (the single coherent classifyItem
            write). Task and Code only: unclassified is a starting state, not a destination.
            Disabled with a hint when the row's shape forbids a type change. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={!canChangeType}
            title={canChangeType ? undefined : CLASSIFY_DISABLED_HINT}
          >
            Classify as…
            <ChevronRight size={12} className="text-muted-foreground" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onSelect={() => {
                onClassify('task');
              }}
            >
              Task
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onClassify('code');
              }}
            >
              Code
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Dispatch — one entry for every destination: the row's labels name where it goes (a
            task to its folder, a code story through the factory gate, a code parent into a new
            epic). Always rendered on an Inbox row, disabled while the labels are incomplete
            with the blocker itself as the hint — the same words the bulk bar's readiness line
            uses. The "…" appears only when a dialog will open (a code parent with no project). */}
        {dispatch !== null && (
          <DropdownMenuItem
            disabled={dispatch.kind === 'blocked'}
            title={dispatch.kind === 'blocked' ? `Not ready — ${dispatch.blocker}` : undefined}
            onSelect={onDispatch}
          >
            <SendHorizontal size={16} className="text-muted-foreground" />
            {dispatch.kind === 'epic' && dispatch.opensDialog ? 'Dispatch…' : 'Dispatch'}
          </DropdownMenuItem>
        )}

        {/* Move to folder — dispatched rows only. Inside the Inbox the folder is a label the
            chip sets and Dispatch acts on; once an item has left, this is how it changes
            folders or comes back. */}
        {canMoveToFolder && folders.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Move to…
              <ChevronRight size={12} className="text-muted-foreground" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onSelect={() => {
                  onMoveToFolder();
                }}
              >
                Inbox
              </DropdownMenuItem>
              {folders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onSelect={() => {
                    onMoveToFolder(folder.id);
                  }}
                >
                  {folder.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        {/* Delete */}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
