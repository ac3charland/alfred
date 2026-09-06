'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  MoreHorizontal,
  Plus,
  SendHorizontal,
} from 'lucide-react';
import * as React from 'react';

import { Calendar } from '@/components/atoms/calendar';
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
import { DropdownMenuSelectSub } from '@/components/atoms/dropdown-menu-select-sub';
import { IconButton } from '@/components/atoms/icon-button';
import type { PickerChipOption } from '@/components/atoms/picker-chip';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/atoms/popover';
import type { RowMetaEditing } from '@/components/tasks/task-row/row-meta-cluster';
import { addDays, todayISODate } from '@/lib/date-utils';
import { PRIORITY_OPTIONS, isPriorityLevel } from '@/lib/priority';
import { useEpics, useProjects } from '@/lib/stores/code-store';
import type { RowDispatchAction } from '@/lib/tasks/dispatch';
import { epicOptions, folderOptions, projectOptions } from '@/lib/tasks/label-options';
import { isDispatched } from '@/lib/tasks/residency';
import type { ItemNode } from '@/lib/tree';
import { isTempId } from '@/lib/tree';
import type { Folder } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The Epic submenu's blocker, verbatim from the Epic chip so the two surfaces never drift. */
const EPIC_NEEDS_PROJECT_HINT = 'Pick a project first';

/** The Due-date submenu's sentinel value: "open the calendar", not a date. */
const CUSTOM_DATE = 'custom';

interface TaskRowMenuProperties {
  /** The row itself — the menu derives its own pure shape gates (root, childless, temp id). */
  node: ItemNode;
  /**
   * True when the row's type may change: a top-level row with no subtasks. A structural guard
   * on Classify as…, not the whole gate — the type also has to be unset (`isUnclassified`).
   * The dangerous flip is a PARENT's, which nothing below the UI catches; see useTaskRowFlags.
   */
  canChangeType: boolean;
  /** True for a `task` row (Due date / Priority are task-only, as the DB CHECK has it). */
  isTask: boolean;
  /** True while the row still has no type — the one state that offers Classify as…. */
  isUnclassified: boolean;
  /** True for a code row (its subtask affordance is "Add story"). */
  isCode: boolean;
  /** May host subtasks (any task, or a code root) — offers the mobile Add subtask/story item. */
  canAddSubtask: boolean;
  /**
   * True inside the Completed view, where the folder label stays off: the row's context label
   * already names where the item lives (the same rule the row's folder chip follows).
   */
  isCompletedView: boolean;
  /**
   * What Dispatch would do on this row, or `null` when the row offers no Dispatch at all — a
   * subtask (residency travels with its root), a row that has already left the Inbox, or a
   * history row in the Completed view.
   */
  dispatch: RowDispatchAction | null;
  /** The folders the row can be labelled with or moved into. */
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
  /**
   * The label writes, the same bundle `RowMetaCluster` takes — one set of handlers, one store
   * action per field, whichever surface the value is edited from.
   */
  editing: RowMetaEditing;
}

/**
 * The task row's "More actions" dropdown. **"Open details" leads** (teal, the primary action —
 * it's how the detail is reached now), then a divider. On mobile a row that may host subtasks
 * shows **"Add subtask"** (or **"Add story"** on a code root) just below that divider — the
 * inline "+" button is desktop-only, so the affordance collapses into this menu below `md`
 * (ALF-118); the item is `md:hidden` so desktop never doubles up. Then the triage pair, in the
 * order the Inbox is worked: **the label group** sets the labels, **Dispatch** acts on them —
 * one entry for every destination (a folder, the factory, a new epic), disabled with the
 * blocker as its hint until the labels are complete (ALF-185).
 *
 * The label group is what a row's type has to say about it, so it is per-type and it *replaces*
 * **Classify as…**: a typed row has no type left to change (correcting one after the fields are
 * filled would silently drop them — Delete and re-capture is the way back), and an untyped row
 * has no fields to hang a label on, so it carries Classify as… instead. One slot, two
 * occupants, never both. A row still carrying a temp id shows neither: a PATCH by that id would
 * 400 and roll back, so every entry here waits out the reconcile.
 *
 * A row that has already left the Inbox offers **Move to…** in place of the Folder submenu — the
 * only place a folder is a move rather than a label. Finally a destructive Delete below a
 * divider. Every conditional stays encapsulated here so the row body composes the menu without
 * restating them.
 */
export function TaskRowMenu({
  node,
  canChangeType,
  isTask,
  isUnclassified,
  isCode,
  canAddSubtask,
  isCompletedView,
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
  editing,
}: TaskRowMenuProperties) {
  const projects = useProjects();
  const epics = useEpics();
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  // "Custom… was picked" — read by the menu's own close, which is when the calendar opens.
  const calendarPending = React.useRef(false);

  // The pure shape terms — what the node itself says, with no duplicate of the type derivation
  // that `useTaskRowFlags` already owns and passes in.
  const isRoot = node.parent_id === null;
  const isChildless = node.children.length === 0;
  // Every label entry (and Classify as…) waits out the optimistic window: a write keyed by a
  // temp id hits a route that validates the id as a UUID, 400s and rolls back, leaving a bare
  // failure toast after a pick that looked fine.
  const isSaving = isTempId(node.id);

  // `due_date` is a `timestamptz`, so a reconciled row carries `2026-09-04T00:00:00+00:00`.
  // Normalise to the calendar date once: it is what a preset is ticked against, and the only
  // form `addDays` accepts (a raw timestamp splits into NaN and throws).
  const currentDue = node.due_date === null ? null : node.due_date.slice(0, 10);

  // Built here, not at module scope: at module scope `today` freezes at first import, so the
  // presets would go stale after midnight in a long-lived tab.
  const dueOptions = React.useMemo<PickerChipOption[]>(() => {
    const today = todayISODate();
    return [
      { value: today, label: 'Today' },
      { value: addDays(today, 1), label: 'Tomorrow' },
      { value: addDays(today, 7), label: 'Next week' },
      // "No due date" only when there is one to clear — its handler already no-ops otherwise.
      ...(currentDue === null ? [] : [{ value: null, label: 'No due date' }]),
      { value: CUSTOM_DATE, label: 'Custom…' },
    ];
  }, [currentDue]);

  const priorityOptions: PickerChipOption[] = [
    { value: null, label: <span className="text-muted-foreground">No priority</span> },
    ...PRIORITY_OPTIONS.map((option) => ({
      value: option.value,
      label: (
        <>
          <option.icon size={12} className={cn('shrink-0', option.iconClass)} />
          {option.label}
        </>
      ),
    })),
  ];

  // The five label submenus, each gated on its field's own domain rule rather than a blanket
  // type check — the same rules `dispatchReadiness` names as blockers, so the cue, the hint and
  // the fix share one vocabulary.
  const showDueDate = !isSaving && isTask;
  const showPriority = !isSaving && isTask;
  // The folder-as-LABEL case: a top-level, undispatched task. Once dispatched, "Move to…" below
  // owns the folder (it is a move then, not a label) and two folder entries would be a puzzle;
  // a subtask's residency travels with its root; and in the Completed view the row's context
  // label owns "where this lives", so the chip refuses to draw there and the write would land
  // nowhere visible.
  const showFolder = !isSaving && isTask && isRoot && !isDispatched(node) && !isCompletedView;
  const showProject = !isSaving && isCode && isRoot;
  // Only a code STORY carries an epic hint. A code root with children is an epic-in-waiting —
  // the conversion creates its epic — and a code child becomes a story under it and inherits it.
  const showEpic = !isSaving && isCode && isRoot && isChildless;
  const showClassify = !isSaving && isUnclassified && canChangeType;

  const epicsForProject = epics.filter((e) => e.project_id === node.intended_project_id);

  return (
    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The calendar the Due-date submenu's "Custom…" opens is anchored to this same
            button: the menu closes on select, so the popover cannot live inside it. */}
          <PopoverAnchor asChild>
            <IconButton size="md" aria-label="More actions">
              {/* Enlarged glyph on mobile (18px) to match the bigger add-subtask "+"; today's
                14px at md+. */}
              <MoreHorizontal size={14} className="h-[18px] w-[18px] md:h-3.5 md:w-3.5" />
            </IconButton>
          </PopoverAnchor>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!calendarPending.current) return;
            calendarPending.current = false;
            // The menu is done closing, so this is the moment the calendar can take the
            // surface. Suppressing the menu's own focus return is the load-bearing half: left
            // to run, it moves focus to the ⋯ button — outside the popover — and Radix reads
            // that as an outside interaction and closes the calendar the frame it appears.
            event.preventDefault();
            setCalendarOpen(true);
          }}
        >
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

          {/* Due date ▸ — three presets off today, the clear entry once there is a date, and
            "Custom…" for everything else. Not a calendar grid: a 7-column grid inside a submenu
            breaks Radix's roving focus (arrows move between items, not cells) and is a cramped
            touch target. */}
          {showDueDate && (
            <DropdownMenuSelectSub
              label="Due date…"
              value={currentDue}
              options={dueOptions}
              separatorAfter={2}
              onSelect={(value) => {
                if (value === CUSTOM_DATE) {
                  // Not `setCalendarOpen(true)` here: the menu is still tearing down, and its
                  // focus restoration lands outside the just-mounted popover, which dismisses
                  // itself. Hand the open to `onCloseAutoFocus` below instead.
                  calendarPending.current = true;
                  return;
                }
                // Clearing routes through the clear path, not `onSelectDueDate(null)`: a due
                // date carries any recurrence rule, which has nowhere to anchor without one.
                if (value === null) editing.onClearDueDate();
                else editing.onSelectDueDate(value);
              }}
            />
          )}

          {/* Priority ▸ — the same list, glyphs and order as the chip's PriorityMenu. */}
          {showPriority && (
            <DropdownMenuSelectSub
              label="Priority…"
              value={isPriorityLevel(node.priority) ? node.priority : null}
              options={priorityOptions}
              separatorAfter={0}
              onSelect={(value) => {
                // Back through the level list rather than a cast: the submenu speaks in
                // `string | null`, and only a value that IS one of the levels may be written.
                editing.onChangePriority(
                  PRIORITY_OPTIONS.find((o) => o.value === value)?.value ?? null,
                );
              }}
            />
          )}

          {/* Folder ▸ — the folder the row is LABELLED with (`setFolder`); the row stays in the
            Inbox until Dispatch acts on it. */}
          {showFolder && (
            <DropdownMenuSelectSub
              label="Folder…"
              value={node.folder_id}
              options={folderOptions(folders, 'No folder')}
              onSelect={editing.onSetFolder}
            />
          )}

          {/* Project ▸ — the pre-factory project hint both code dispatch paths need (a story's
            factory gate, and an epic-shaped row's conversion, whose dialog is "no project set"). */}
          {showProject && (
            <DropdownMenuSelectSub
              label="Project…"
              value={node.intended_project_id}
              options={projectOptions(projects, 'No project')}
              onSelect={editing.onSetProject}
            />
          )}

          {/* Epic ▸ — the selected project's epics. Disabled until there is a project to derive
            them from, and the hint is VISIBLE text as well as a title: a disabled sub-trigger is
            `pointer-events-none`, so no tooltip is ever drawn (and on touch there is none). */}
          {showEpic && (
            <DropdownMenuSelectSub
              label="Epic…"
              value={node.intended_epic_id}
              options={epicOptions(epicsForProject, 'No epic')}
              disabled={node.intended_project_id === null}
              hint={EPIC_NEEDS_PROJECT_HINT}
              onSelect={editing.onSetEpic}
            />
          )}

          {/* Classify as ▸ — sets the row's type (the single coherent classifyItem write). Task
            and Code only: unclassified is a starting state, not a destination. Absent once a
            type is set — a flip after the fields are filled would drop what the new type
            forbids, so the way back is Delete and re-capture. */}
          {showClassify && (
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
            Folder submenu sets and Dispatch acts on; once an item has left, this is how it
            changes folders or comes back. */}
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

      {/* The "Custom…" calendar, anchored to the ⋯ button the menu just closed over. */}
      <PopoverContent align="end">
        <Calendar
          selected={currentDue}
          onSelect={(iso) => {
            editing.onSelectDueDate(iso);
            setCalendarOpen(false);
          }}
          onClear={() => {
            editing.onClearDueDate();
            setCalendarOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
