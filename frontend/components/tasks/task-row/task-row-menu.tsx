'use client';

import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';

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

interface TaskRowMenuProperties {
  /** True for a `task` row, which alone nests subtasks (offers the mobile "Add subtask" item). */
  isTask: boolean;
  /** True when the row still has no classification (offers the Classify-as submenu). */
  isUnclassified: boolean;
  /** True for a code-classified inbox item (offers "Send to Code module…"). */
  isCode: boolean;
  /** True for a task / unclassified row (offers "Convert to Code Story…"). */
  canConvert: boolean;
  /** The folders the row can be moved into (the "Move to…" submenu; hidden when empty). */
  folders: readonly Folder[];
  /** Open the row's inline add-subtask field (the leading, mobile-only entry — see ALF-118). */
  onAddSubtask: () => void;
  /** Open the row's inline detail panel (the primary, leading entry). */
  onOpenDetails: () => void;
  onClassify: (itemType: 'task' | 'code') => void;
  onOpenGate: () => void;
  onMoveToFolder: (targetFolderId?: string) => void;
  onDelete: () => void;
}

/**
 * The task row's "More actions" dropdown. On mobile a task row's **"Add subtask" leads** — the
 * inline "+" button is desktop-only now, so the affordance collapses into this menu below `md`
 * (ALF-118); it and its divider are `md:hidden` so desktop, where the "+" is still shown, never
 * doubles up. Then **"Open details"** (teal, the primary action — it's how the detail is reached
 * now), the item-type entries (Classify-as while unclassified, Send/Convert for code vs task),
 * Move-to (when folders exist), and finally a destructive Delete below a divider. The per-field
 * "Set due date / Set priority / Add notes" entries are gone — those edits live on the detail
 * panel's auto-saving chips and notes. Every conditional stays encapsulated here so the row body
 * composes the menu without restating them.
 */
export function TaskRowMenu({
  isTask,
  isUnclassified,
  isCode,
  canConvert,
  folders,
  onAddSubtask,
  onOpenDetails,
  onClassify,
  onOpenGate,
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
        {/* Add subtask — mobile-only (`md:hidden`): the inline "+" button is hidden below `md`,
            so its affordance lives here at the top of the menu (ALF-118). Task rows only, since
            subtasks nest only under tasks. The divider is `md:hidden` too so desktop — where the
            "+" is shown and this item isn't — never renders a stray leading separator. */}
        {isTask && (
          <>
            <DropdownMenuItem className="md:hidden" onSelect={onAddSubtask}>
              <Plus size={16} className="text-muted-foreground" />
              Add subtask
            </DropdownMenuItem>
            <DropdownMenuSeparator className="md:hidden" />
          </>
        )}

        {/* Open details — the primary action, highlighted teal. Opens the inline detail panel
            with the auto-saving Due / Repeat / Priority chips and the notes editor. */}
        <DropdownMenuItem
          onSelect={onOpenDetails}
          className="font-semibold text-accent-teal focus:text-accent-teal data-[highlighted]:bg-accent-teal/10"
        >
          Open details
        </DropdownMenuItem>

        <DropdownMenuSeparator />

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

        {/* Send to Code module… — a code-classified inbox item enters the gate. */}
        {isCode && <DropdownMenuItem onSelect={onOpenGate}>Send to Code module…</DropdownMenuItem>}

        {/* Convert to Code Story… — the path for an existing task (or an unclassified item):
            the gate both flips item_type and creates the factory row in one step. */}
        {canConvert && (
          <DropdownMenuItem onSelect={onOpenGate}>Convert to Code Story…</DropdownMenuItem>
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
