'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { GateDialog, type GateItem } from '@/components/code/gate-dialog';
import { useFolders } from '@/lib/stores/folders-store';
import { useInboxSelection, useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import { useScopedTasks, useTaskActions } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';

import { bulkBarClass, bulkBarWrapperClass } from './inbox-bulk-bar.styles';

const CLASSIFY_DISABLED_HINT = 'Only unclassified items can be classified';
const MOVE_DISABLED_HINT = 'Only tasks can be filed into a folder';

/**
 * The Inbox header's "Select" / "Done" toggle. Pressing it enters multi-edit mode (rows become
 * selection checkboxes) or exits it; sits beside the CollapseAllButton.
 */
export function InboxSelectToggle() {
  const { active } = useInboxSelection();
  const { enter, exit } = useInboxSelectionActions();

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={() => {
        if (active) exit();
        else enter();
      }}
    >
      {active ? 'Done' : 'Select'}
    </Button>
  );
}

/**
 * The Inbox bulk action bar: shown only while select mode is on and ≥1 item is selected. Each
 * action is gated on the selection's composition (the same type-coherence the single-row menu
 * applies, lifted to a set): Classify needs an all-unclassified selection, Move needs an
 * all-task one, Send-to-Code admits any. A full success clears the selection and exits mode; a
 * partial failure keeps just the failed items selected so they can be retried. Esc exits.
 *
 * The effective selection is the stored ids intersected with the items still in the Inbox, so
 * an item that has left (gated/moved away) simply stops counting — and a prune keeps the store
 * set in step.
 */
export function InboxBulkBar() {
  const { active, selectedIds } = useInboxSelection();
  const { exit, prune } = useInboxSelectionActions();
  const { bulkClassify, bulkMove, removeGatedItem } = useTaskActions();
  const { showToast } = useToastActions();
  const folders = useFolders();
  const inboxNodes = useScopedTasks({ type: 'inbox' });
  const [showGate, setShowGate] = React.useState(false);

  const selectedItems = React.useMemo(
    () => inboxNodes.filter((node) => selectedIds.has(node.id)),
    [inboxNodes, selectedIds],
  );

  // Keep the stored set in sync with what's actually in the Inbox (prune is a no-op — same set
  // reference — when nothing left, so this never loops).
  React.useEffect(() => {
    if (active) prune(inboxNodes.map((node) => node.id));
  }, [active, inboxNodes, prune]);

  // Esc exits select mode — but not while the gate is open (there, Esc closes the gate). Stays
  // wired whenever select mode is on, even at zero selection (when this renders nothing).
  React.useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showGate) exit();
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown);
    };
  }, [active, showGate, exit]);

  const ids = selectedItems.map((item) => item.id);
  const count = selectedItems.length;
  const allUnclassified = count > 0 && selectedItems.every((i) => i.item_type === 'unclassified');
  const allTask = count > 0 && selectedItems.every((i) => i.item_type === 'task');

  // After a bulk action: full success exits; a partial failure narrows the selection to the
  // failed items so the same action can be retried on just those.
  const settle = (failed: string[]) => {
    if (failed.length === 0) exit();
    else prune(failed);
  };

  const handleClassify = async (itemType: 'task' | 'code') => {
    settle(await bulkClassify(ids, itemType));
  };

  const handleMove = async (folderId: string | null) => {
    settle(await bulkMove(ids, folderId));
  };

  const gateItems: GateItem[] = selectedItems.map((item) => ({
    id: item.id,
    title: item.title,
    notes: item.notes,
    source_url: item.source_url,
    intendedProjectId: item.intended_project_id,
  }));

  const handleGateComplete = () => {
    for (const item of selectedItems) removeGatedItem(item.id);
    showToast(`Sent ${String(count)} item${count === 1 ? '' : 's'} to Code`);
    exit();
  };

  if (!active || count === 0) return null;

  return (
    <>
      {/* In-flow spacer: the bar is a fixed floating layer, so reserve room here where it used to
          sit so it never covers the last inbox rows. */}
      <div aria-hidden className="h-20" />

      <div className={bulkBarWrapperClass}>
        <div role="region" aria-label="Bulk actions" className={bulkBarClass}>
          <span className="mr-1 text-sm font-semibold text-accent-teal">{count} selected</span>

          {/* Classify as — only when every selected item is still unclassified. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!allUnclassified}
                title={allUnclassified ? undefined : CLASSIFY_DISABLED_HINT}
              >
                Classify as
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  void handleClassify('task');
                }}
              >
                Task
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void handleClassify('code');
                }}
              >
                Code
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Move to folder — only when every selected item is a task. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!allTask}
                title={allTask ? undefined : MOVE_DISABLED_HINT}
              >
                Move to folder
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  void handleMove(null);
                }}
              >
                Inbox
              </DropdownMenuItem>
              {folders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onSelect={() => {
                    void handleMove(folder.id);
                  }}
                >
                  {folder.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Send to Code — any non-empty selection is eligible. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowGate(true);
            }}
          >
            Send to Code…
          </Button>

          <Button variant="ghost" size="sm" className="ml-auto" onClick={exit}>
            Done
          </Button>
        </div>
      </div>

      <GateDialog
        open={showGate}
        onOpenChange={setShowGate}
        items={gateItems}
        onComplete={handleGateComplete}
      />
    </>
  );
}
