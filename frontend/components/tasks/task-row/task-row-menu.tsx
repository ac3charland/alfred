'use client';

import { ChevronRight, MoreHorizontal } from 'lucide-react';

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
  /** True when the row still has no classification (offers the Classify-as submenu). */
  isUnclassified: boolean;
  /** True for a code-classified inbox item (offers "Send to Code module…"). */
  isCode: boolean;
  /** True for a task / unclassified row (offers "Convert to Code Story…"). */
  canConvert: boolean;
  /** True for a `task` row (offers the due-date entry; due dates are task-only). */
  isTask: boolean;
  /** Whether the row currently carries a due date (toggles the Set/Edit label). */
  hasDueDate: boolean;
  /** Whether the row currently carries notes (toggles the Add/Edit label). */
  hasNotes: boolean;
  /** The folders the row can be moved into (the "Move to…" submenu; hidden when empty). */
  folders: readonly Folder[];
  onClassify: (itemType: 'task' | 'code') => void;
  onOpenGate: () => void;
  onSetDueDate: () => void;
  onEditNotes: () => void;
  onMoveToFolder: (targetFolderId?: string) => void;
  onDelete: () => void;
}

/**
 * The task row's "More actions" dropdown. Every entry's visibility gates on the row's
 * item-type flags (Classify-as while unclassified; Send/Convert for code vs task; due date
 * for tasks; Move-to when folders exist) — those conditionals stay encapsulated here so the
 * row body composes the menu without restating them. Uses the styled `DropdownMenu*` atoms.
 */
export function TaskRowMenu({
  isUnclassified,
  isCode,
  canConvert,
  isTask,
  hasDueDate,
  hasNotes,
  folders,
  onClassify,
  onOpenGate,
  onSetDueDate,
  onEditNotes,
  onMoveToFolder,
  onDelete,
}: TaskRowMenuProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="md" aria-label="More actions">
          <MoreHorizontal size={14} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Classify as ▸ — inbox triage, offered only while the row is
            still unclassified. Picking a type flips item_type (the optimistic
            classifyItem action). Knowledge is reserved — leave room, don't build
            it. "Send to Code module…" / "Convert to Code Story…" route into the Code module. */}
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
              {/* Knowledge: reserved — future type, not built. */}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Send to Code module… — a code-classified inbox item enters the gate.
            The RPC creates the code_items sidecar; the item then
            leaves the Tasks/Inbox views. */}
        {isCode && <DropdownMenuItem onSelect={onOpenGate}>Send to Code module…</DropdownMenuItem>}

        {/* Convert to Code Story… — the path for an existing task (or an
            unclassified item): the gate both flips item_type and creates the
            factory row in one step (the enter_code_module RPC clears task-only
            fields, so a task with a due date / subtasks converts safely). */}
        {canConvert && (
          <DropdownMenuItem onSelect={onOpenGate}>Convert to Code Story…</DropdownMenuItem>
        )}

        {/* Set/Edit due date — `task`-only. */}
        {isTask && (
          <DropdownMenuItem onSelect={onSetDueDate}>
            {hasDueDate ? 'Edit due date' : 'Set due date'}
          </DropdownMenuItem>
        )}

        {/* Edit notes */}
        <DropdownMenuItem onSelect={onEditNotes}>
          {hasNotes ? 'Edit notes' : 'Add notes'}
        </DropdownMenuItem>

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
