'use client';

import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';

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
import type { Folder } from '@/lib/types';

/** Why "Convert to Code Story…" is disabled on a row with subtasks. */
const STORY_DISABLED_HINT = 'A story is a single item — this one has subtasks.';
/** Why "Convert to Code Epic…" (and an epic-shaped send) is disabled on the wrong shape. */
const EPIC_DISABLED_HINT =
  'An epic needs at least one subtask, and its subtasks must not have subtasks of their own.';
/** Why an epic conversion is disabled while a row in the group is still saving. */
const TEMP_ID_HINT = 'Still saving — try again in a moment.';

interface TaskRowMenuProperties {
  /** True when the row still has no classification (offers the Classify-as submenu). */
  isUnclassified: boolean;
  /** True for a code-classified inbox item (offers "Send to Code module…"). */
  isCode: boolean;
  /** True for a code child — it converts with its parent, so it offers no send entry. */
  isCodeChild: boolean;
  /** True for a code root with ≥1 child — "Send to Code module" runs the epic conversion. */
  isCodeParent: boolean;
  /**
   * True when a code parent's send fires immediately (an intended project is already set) —
   * the label drops its "…" because no dialog will open.
   */
  sendConvertsImmediately: boolean;
  /** True for a task / unclassified row (renders the adjacent Convert to Story/Epic pair). */
  canConvert: boolean;
  /** True when "Convert to Code Story…" applies (a convertible row with no subtasks). */
  canConvertToStory: boolean;
  /** True when "Convert to Code Epic…" applies (≥1 active child, no grandchildren). */
  canConvertToEpic: boolean;
  /**
   * True while this row or one of its children still carries a temp (unreconciled) id — the
   * conversion RPC needs real ids, so the epic-shaped actions disable until the saves land.
   */
  groupHasTempIds: boolean;
  /** May host subtasks (any task, or a code root) — offers the mobile Add subtask/story item. */
  canAddSubtask: boolean;
  /** The folders the row can be moved into (the "Move to…" submenu; hidden when empty). */
  folders: readonly Folder[];
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
  /** Open the story gate (Send a childless code row / Convert to Code Story). */
  onOpenGate: () => void;
  /**
   * Run the epic conversion (a code parent's send, or Convert to Code Epic…). The row
   * decides between the immediate path (intended project set) and the project dialog.
   */
  onConvertToEpic: () => void;
  onMoveToFolder: (targetFolderId?: string) => void;
  onDelete: () => void;
}

/**
 * The task row's "More actions" dropdown. **"Open details" leads** (teal, the primary action —
 * it's how the detail is reached now), then a divider. On mobile a row that may host subtasks
 * shows **"Add subtask"** (or **"Add story"** on a code root) just below that divider — the
 * inline "+" button is desktop-only, so the affordance collapses into this menu below `md`
 * (ALF-118); the item is `md:hidden` so desktop never doubles up. Then the item-type entries:
 * Classify-as while unclassified; "Send to Code module" for a code row (the story gate when
 * childless, the epic conversion when it has children); the adjacent "Convert to Code Story…"
 * / "Convert to Code Epic…" pair for a convertible row — both always rendered, each disabled
 * with a hint when it doesn't apply, so the epic path stays discoverable. Then Move-to (when
 * folders exist), and finally a destructive Delete below a divider. Every conditional stays
 * encapsulated here so the row body composes the menu without restating them.
 */
export function TaskRowMenu({
  isUnclassified,
  isCode,
  isCodeChild,
  isCodeParent,
  sendConvertsImmediately,
  canConvert,
  canConvertToStory,
  canConvertToEpic,
  groupHasTempIds,
  canAddSubtask,
  folders,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onAddSubtask,
  onOpenDetails,
  onClassify,
  onOpenGate,
  onConvertToEpic,
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

        {/* Classify as ▸ — inbox triage, offered only while the row is still unclassified.
            Picking a type flips item_type (the optimistic classifyItem action). */}
        {isUnclassified && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
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
        )}

        {/* Send to Code module — a childless code root opens the story gate (with "…"); a code
            PARENT runs the epic conversion instead: immediately (no "…") when an intended
            project is set, otherwise via the project dialog. A code child converts with its
            parent, so it offers no send entry. */}
        {isCode &&
          !isCodeChild &&
          (isCodeParent ? (
            <DropdownMenuItem
              disabled={groupHasTempIds}
              title={groupHasTempIds ? TEMP_ID_HINT : undefined}
              onSelect={onConvertToEpic}
            >
              {sendConvertsImmediately ? 'Send to Code module' : 'Send to Code module…'}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onOpenGate}>Send to Code module…</DropdownMenuItem>
          ))}

        {/* Convert to Code Story… / Convert to Code Epic… — always rendered adjacent for a
            convertible row, each disabled (with a hint) when it doesn't apply, so the epic
            path is discoverable rather than appearing only in the one state that allows it. */}
        {canConvert && (
          <>
            <DropdownMenuItem
              disabled={!canConvertToStory}
              title={canConvertToStory ? undefined : STORY_DISABLED_HINT}
              onSelect={onOpenGate}
            >
              Convert to Code Story…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canConvertToEpic || groupHasTempIds}
              title={
                canConvertToEpic ? (groupHasTempIds ? TEMP_ID_HINT : undefined) : EPIC_DISABLED_HINT
              }
              onSelect={onConvertToEpic}
            >
              Convert to Code Epic…
            </DropdownMenuItem>
          </>
        )}

        {/* Move to folder */}
        {folders.length > 0 && (
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
