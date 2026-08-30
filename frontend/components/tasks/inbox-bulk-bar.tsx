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
import { projectBoardHref } from '@/lib/code/board-links';
import { useCodeActions } from '@/lib/stores/code-store';
import { useDepartingItemsActions } from '@/lib/stores/departing-items-store';
import { useFolders } from '@/lib/stores/folders-store';
import { useInboxSelection, useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import { useScopedTasks, useTaskActions } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';
import type { DispatchBlocker } from '@/lib/tasks/dispatch';
import { DISPATCH_READY_LABEL, dispatchReadiness, summarizeBlockers } from '@/lib/tasks/dispatch';
import type { CodeStory } from '@/lib/types';

import {
  bulkBarClass,
  bulkBarStackClass,
  bulkBarWrapperClass,
  readinessLineClass,
} from './inbox-bulk-bar.styles';

const CLASSIFY_DISABLED_HINT = 'Only a top-level item with no subtasks can change type';
const MOVE_DISABLED_HINT = 'Only tasks and unclassified items can be filed into a folder';
const SEND_DISABLED_HINT = 'An item with subtasks is dispatched from its own row menu';
// Lower-cased mid-sentence — DISPATCH_READY_LABEL itself is the row's title-cased cue (ALF-178).
const DISPATCH_DISABLED_HINT = `Nothing in the selection is ${DISPATCH_READY_LABEL.toLowerCase()}`;

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
 * The Inbox bulk action bar: shown only while select mode is on and ≥1 item is selected.
 * **Dispatch leads** — the primary action, the only one styled accent: it sends each READY
 * selected item to its own destination in one press (a task to its labelled folder, a code item
 * through the factory gate), leaving unready items selected with the readiness line naming what
 * each is missing. The other actions are gated on the selection's composition: Classify needs
 * every row to be a childless root (the type-change shape gate), Move needs tasks/unclassified
 * rows, Send-to-Code stays the "choose the project and epic now" path. A full success clears
 * the selection and exits mode; a partial outcome keeps the unfinished items selected. Esc exits.
 *
 * The effective selection is the stored ids intersected with the items still in the Inbox, so
 * an item that has left (gated/moved away) simply stops counting — and a prune keeps the store
 * set in step.
 */
export function InboxBulkBar() {
  const { active, selectedIds } = useInboxSelection();
  const { exit, prune } = useInboxSelectionActions();
  const { bulkClassify, bulkMove, dispatchItems, removeGatedItem } = useTaskActions();
  const { convertTaskToCode } = useCodeActions();
  const { depart, clear: clearDeparting } = useDepartingItemsActions();
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
  // Classify's gate is the type-change SHAPE gate (a childless top-level row), whatever the
  // current type — correcting a type is the common case now, and the old all-unclassified gate
  // disabled the control on precisely the rows that carry a type to correct. Selection only
  // holds roots, so childlessness is the live half of the check.
  const allChildlessRoots =
    count > 0 && selectedItems.every((i) => i.parent_id === null && i.children.length === 0);
  // Move's gate widens to unclassified rows — the smallest honest widening: moveTask already
  // classifies an unclassified row to task as it files it. A code row still can't be filed.
  const allFileable =
    count > 0 &&
    selectedItems.every((i) => i.item_type === 'task' || i.item_type === 'unclassified');
  // The bulk send is story-per-item; an epic-shaped row (any children) goes through its own
  // row menu instead (ALF-129).
  const anySelectedHasChildren = selectedItems.some((i) => i.children.length > 0);

  // Dispatch readiness, derived live from the selection: the ready ones go on press, and the
  // second line names what every unready one is missing — before the press, not after. The
  // ready ids are what the press sends off, so exactly the rows that leave are the rows that
  // animate — an unready one never so much as flickers.
  const blockers: DispatchBlocker[] = [];
  const readyIds: string[] = [];
  for (const item of selectedItems) {
    const readiness = dispatchReadiness(item, item.children.length > 0);
    if (readiness.ready) readyIds.push(item.id);
    else blockers.push(readiness.blocker);
  }
  const readyCount = readyIds.length;
  const readinessLine = summarizeBlockers(blockers);

  // After a bulk action: full success exits; a partial outcome narrows the selection to the
  // unfinished items so the same action can be retried on just those.
  const settle = (staying: string[]) => {
    if (staying.length === 0) exit();
    else prune(staying);
  };

  const handleClassify = async (itemType: 'task' | 'code') => {
    settle(await bulkClassify(ids, itemType));
  };

  const handleMove = async (folderId: string | null) => {
    settle(await bulkMove(ids, folderId));
  };

  const handleDispatch = async () => {
    // Send every ready row off FIRST, all together (ALF-182). The mutation is what filters
    // them out of the Inbox, so calling it now would unmount each row before it could move —
    // the animate-then-commit inversion, hoisted here because one press retires the whole
    // selection at once. `depart` resolves when the exit has played (immediately under reduced
    // motion), and `clearDeparting` afterwards releases any row a failure put back.
    await depart(readyIds);
    // One press, each ready item to its own destination; unready ∪ failed stay selected. The
    // toast counts what actually went, with no deep link — a mixed dispatch has no single
    // destination to link to.
    const staying = await dispatchItems(ids, convertTaskToCode);
    clearDeparting();
    const sent = count - staying.length;
    if (sent > 0) showToast(`Dispatched ${String(sent)} item${sent === 1 ? '' : 's'}`);
    settle(staying);
  };

  const gateItems: GateItem[] = selectedItems.map((item) => ({
    id: item.id,
    title: item.title,
    notes: item.notes,
    source_url: item.source_url,
    intendedProjectId: item.intended_project_id,
    intendedEpicId: item.intended_epic_id,
  }));

  // Settle the bulk send: the admitted items have left task_items, so drop them from the store
  // and confirm with a toast. A batch has no single story to open, but the whole batch shares the
  // gate's one project — so the toast deep-links to that project's board, where they all just
  // landed. (`project_id` is `?? ''` only to satisfy the all-nullable view row type; a reconciled
  // story always carries one.)
  const handleGateComplete = (stories: CodeStory[]) => {
    for (const item of selectedItems) removeGatedItem(item.id);
    const projectId = stories[0]?.project_id ?? '';
    showToast(
      `Sent ${String(count)} item${count === 1 ? '' : 's'} to Code`,
      'default',
      projectId === '' ? undefined : projectBoardHref(projectId),
    );
    exit();
  };

  if (!active || count === 0) return null;

  return (
    <>
      {/* In-flow spacer: the bar is a fixed floating layer, so reserve room here where it used to
          sit so it never covers the last inbox rows. */}
      <div aria-hidden className="h-20" />

      <div className={bulkBarWrapperClass}>
        <div className={bulkBarStackClass}>
          <div role="region" aria-label="Bulk actions" className={bulkBarClass}>
            <span className="mr-1 text-sm font-semibold text-accent-teal">{count} selected</span>

            {/* Dispatch — the primary action: each ready item to its own destination, in one
              press. Enabled from one ready item; unready items are never sent. */}
            <Button
              variant="accent"
              size="sm"
              disabled={readyCount === 0}
              title={readyCount === 0 ? DISPATCH_DISABLED_HINT : undefined}
              onClick={() => {
                void handleDispatch();
              }}
            >
              Dispatch
            </Button>

            {/* Classify as — every selected row must be a childless root (the shape gate the
              database can't enforce on a parent). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!allChildlessRoots}
                  title={allChildlessRoots ? undefined : CLASSIFY_DISABLED_HINT}
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

            {/* Move to folder — tasks and unclassified rows (filing classifies the latter). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!allFileable}
                  title={allFileable ? undefined : MOVE_DISABLED_HINT}
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

            {/* Send to Code — story-per-item, so it disables when any selected row has children.
              It stays the "choose the project and epic now" path (it hosts "+ New epic…");
              Dispatch is the "use what's already set" path. Neither subsumes the other. */}
            <Button
              variant="outline"
              size="sm"
              disabled={anySelectedHasChildren}
              title={anySelectedHasChildren ? SEND_DISABLED_HINT : undefined}
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

          {/* The readiness line — what the selection is missing, grouped by reason with counts,
              derived live so it updates as rows are selected, corrected in the panel, or
              dropped. It arrives BEFORE the press, and after a partial dispatch it is simply
              what remains. */}
          {readinessLine !== null && (
            <div role="status" className={readinessLineClass}>
              {readinessLine}
            </div>
          )}
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
