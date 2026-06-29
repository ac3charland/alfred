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
  /** The folders the row can be moved into (the "Move to…" submenu; hidden when empty). */
  folders: readonly Folder[];
  /** Open the row's inline detail panel (the primary, leading entry). */
  onOpenDetails: () => void;
  onClassify: (itemType: 'task' | 'code') => void;
  onOpenGate: () => void;
  onMoveToFolder: (targetFolderId?: string) => void;
  onDelete: () => void;
}

/**
 * The task row's "More actions" dropdown. **"Open details" leads** (teal, the primary action —
 * it's how the detail is reached now), then the item-type entries (Classify-as while
 * unclassified, Send/Convert for code vs task), Move-to (when folders exist), and finally a
 * destructive Delete below a divider. The per-field "Set due date / Set priority / Add notes"
 * entries are gone — those edits live on the detail panel's auto-saving chips and notes. Every
 * conditional stays encapsulated here so the row body composes the menu without restating them.
 */
export function TaskRowMenu({
  isUnclassified,
  isCode,
  canConvert,
  folders,
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
          <MoreHorizontal size={14} />
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
