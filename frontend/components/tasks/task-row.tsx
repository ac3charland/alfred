'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, ChevronRight, ListCheck, Plus } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { AnimatedHeightEnter } from '@/components/atoms/animated-height-enter';
import { AnimatedHeightReveal } from '@/components/atoms/animated-height-reveal';
import { Button } from '@/components/atoms/button';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { IconButton } from '@/components/atoms/icon-button';
import { InlineEditField } from '@/components/atoms/inline-edit-field';
import { EpicGateDialog } from '@/components/code/epic-gate-dialog';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { ClassificationMark } from '@/components/tasks/classification-mark';
import { SubtaskGap } from '@/components/tasks/subtask-gap';
import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { RowMetaCluster } from '@/components/tasks/task-row/row-meta-cluster';
import { TaskDetailPanel } from '@/components/tasks/task-row/task-detail-panel';
import { TaskRowMenu } from '@/components/tasks/task-row/task-row-menu';
import type { ConvertedEpic } from '@/lib/api-client';
import { projectBoardHref, storyBoardHref } from '@/lib/code/board-links';
import { useAnimatedRowExit } from '@/lib/hooks/use-animated-row-exit';
import { useDismiss } from '@/lib/hooks/use-dismiss';
import { useFocusItemHighlight } from '@/lib/hooks/use-focus-item-highlight';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import { useSubtaskReorder } from '@/lib/hooks/use-subtask-reorder';
import { useTaskRowFlags } from '@/lib/hooks/use-task-row-flags';
import type { TaskPriority } from '@/lib/priority';
import { parseRecurrenceRule } from '@/lib/recurrence';
import type { RecurrenceRule } from '@/lib/recurrence';
import {
  sameEditor,
  useActiveEditor,
  useActiveEditorActions,
} from '@/lib/stores/active-editor-store';
import { useCodeActions } from '@/lib/stores/code-store';
import { useExpansion, useExpansionActions } from '@/lib/stores/expansion-store';
import { useFolders } from '@/lib/stores/folders-store';
import { useInboxSelection, useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';
import { classificationOrigin } from '@/lib/tasks/classification';
import { rowDispatchAction } from '@/lib/tasks/dispatch';
import { isDispatched, residentFolderId } from '@/lib/tasks/residency';
import type { ItemNode } from '@/lib/tree';
import { getAncestorTitles, getDescendantIds, hasActiveDescendant, isTempId } from '@/lib/tree';
import type { CodeStory } from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import {
  addSubtaskButtonClass,
  captureRevealClass,
  cardChromeClass,
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
  collapseClass,
  collapseInnerClass,
  confirmTitleClass,
  deleteCollapseClass,
  deleteFadeClass,
  dropPlusClass,
  mobileTapClass,
  notesPreviewClass,
  rowActionsClass,
  rowBaseClass,
  rowContentColClass,
  rowDropTargetClass,
  rowHoverClass,
  subtreeClass,
  titleInputClass,
  titleTextClass,
} from './task-row.styles';

interface TaskRowProperties {
  node: ItemNode;
  depth?: number;
  /** True when this row is rendered inside the Completed view (drives the context label). */
  isCompletedView?: boolean;
  /**
   * True for a root Inbox row, which may participate in multi-edit: while select mode is on
   * the row becomes a selection checkbox. Children are never selectable, so they pass false.
   */
  selectable?: boolean;
  /**
   * ALF-117: the reorder gap that sits ABOVE this row (straddling its top edge). Set by a parent
   * for each of its active subtask rows in an active view; absent on roots and in the Completed
   * view (no reorder gesture there).
   */
  reorderGap?: { parentId: string; index: number } | undefined;
  /** ALF-117: the reorder gap BELOW this row — set only on the LAST active sibling of a group. */
  reorderGapBelow?: { parentId: string; index: number } | undefined;
}

/**
 * A single task row, recursively rendering its children — the composition root for the row:
 * layout + the recursive subtree, with cohesive pieces pulled into their own units. The
 * item-type flags (`useTaskRowFlags`), the indentation math (`useIndentation`), and the
 * delicate completion/deletion exits (`useAnimatedRowExit`) are hooks; the actions dropdown
 * (`TaskRowMenu`) and the auto-saving detail panel (`TaskDetailPanel`) are sub-components. The
 * subtask + completed-children reveals use the shared `AnimatedHeightCollapse`; the
 * completion-collapse stays bespoke (its 300ms + `delay-200` timing and the once-only commit
 * differ from the plain 200ms reveal).
 *
 * Features:
 * - Expand/collapse subtask tree (chevron or row-body click)
 * - Checkbox to complete (cascade modal for tasks with children)
 * - Inline title edit; "Open details" reveals the auto-saving due/repeat/priority/notes panel
 * - "Add subtask" affordance
 * - Move-to-folder dropdown + classify / gate entries
 * - Delete
 */
export function TaskRow({
  node,
  depth = 0,
  isCompletedView = false,
  selectable = false,
  reorderGap,
  reorderGapBelow,
}: TaskRowProperties) {
  const folders = useFolders();
  const allTasks = useTasks();
  const {
    completeTask,
    uncompleteTask,
    updateTask,
    moveTask,
    setFolder,
    setIntendedProject,
    setIntendedEpic,
    deleteTask,
    classifyItem,
    dispatchItems,
    settleEpicConversion,
  } = useTaskActions();
  const { showToast } = useToastActions();
  const activeEditor = useActiveEditor();
  const { openEditor, closeEditor } = useActiveEditorActions();
  const prefersReducedMotion = usePrefersReducedMotion();
  const {
    subtasks: expandedSubtasks,
    completed: expandedCompleted,
    details: openDetails,
  } = useExpansion();
  const { toggleSubtasks, expandSubtasks, toggleCompleted, toggleDetails, closeDetails } =
    useExpansionActions();
  const { active: selectModeActive, selectedIds } = useInboxSelection();
  const { toggle: toggleSelection } = useInboxSelectionActions();
  // A selectable root row in active select mode is a selection checkbox, not a normal row.
  const inSelectMode = selectable && selectModeActive;
  const isSelected = selectedIds.has(node.id);
  const isExpanded = expandedSubtasks.has(node.id);
  const showCompleted = expandedCompleted.has(node.id);
  // The inline detail panel ("Open details") — independent of the subtask tree (§08): a row can
  // show its detail, its subtasks, both, or neither.
  const isDetailOpen = openDetails.has(node.id);
  const [showCascadeModal, setShowCascadeModal] = React.useState(false);

  // The open detail panel dismisses on Escape or a pointer press outside this row (ALF-78).
  // Scoping "outside" to the whole row (not just the panel) keeps the ⋯ menu working — its
  // "Open details" entry stays the toggle-closed affordance — while the hook excludes the
  // portaled chip pickers / dialogs so editing a detail never closes it.
  const rowContainerRef = React.useRef<HTMLLIElement>(null);
  const handleDismissDetails = React.useCallback(() => {
    closeDetails(node.id);
  }, [closeDetails, node.id]);
  useDismiss(rowContainerRef, handleDismissDetails, isDetailOpen && !inSelectMode);

  // A row's completed state is read off the node itself (not the view), so a completed
  // child shown under an active parent renders checked + low-contrast, and clicking it
  // reactivates rather than completes.
  const isCompleted = node.status === 'completed';

  // The whole row is a drag source (the row sensors ignore presses on its buttons
  // and inline input, so only a press-and-drag elsewhere lifts it). A task at ANY depth can
  // be dragged to re-parent it; an active task can also be filed into a folder. A completed
  // or temp (unreconciled) id can't be PATCHed yet, so neither is draggable.
  const { draggedSubtreeIds, activeDragItemType } = useTaskDrag();
  // Item-type flags + drop-target validity (completion/due-date/subtask gating, the epic-shaped
  // dispatch, the drop highlight) all derive from the node — see useTaskRowFlags.
  const { isTask, isCode, canAddSubtask, isCodeParent, isValidDropTarget, canChangeType } =
    useTaskRowFlags(node, isCompleted, draggedSubtreeIds, activeDragItemType);

  // Recurrence is top-level-task-only: the parsed rule drives the row chip and the meta-panel
  // Repeat control. A subtask or non-task row never recurs (the control is hidden there).
  const recurrenceRule = React.useMemo<RecurrenceRule | null>(
    () => parseRecurrenceRule(node.recurrence),
    [node.recurrence],
  );
  const isTopLevelTask = isTask && node.parent_id === null;

  // "An Inbox row": top-level, still undispatched, and not being listed as history. Read by the
  // two things that only make sense while an item is still awaiting triage — the "Task" badge
  // and the provenance mark — so the two can never gate differently.
  const isInboxRow = node.parent_id === null && !isCompletedView && !isDispatched(node);

  // "Code" earns a row badge everywhere (the rare, meaningful distinction). "Task" shows one
  // ONLY on an Inbox row, the one surface that now holds unclassified, task and code rows side
  // by side, where a bare task row and an unclassified row would otherwise be pixel-identical
  // while behaving differently under Dispatch. Everywhere else (folder views, Completed,
  // subtasks) a task keeps showing no badge — the ALF-67 / ALF-65 judgement, intact everywhere
  // it was made about. An unclassified row has no badge.
  const showTypeBadge = node.item_type === 'code' || (node.item_type === 'task' && isInboxRow);

  // Where this row's labels came from — the classifier, your own hand, or nothing yet (ALF-180).
  // Inbox rows only, and each clause earns its place: the classifier's sweep predicate is
  // `parent_id is null`, so marking a subtask "not yet classified" would promise a judgement
  // nothing intends to make; once an item is dispatched the question is settled, since
  // provenance is a triage aid; and the Completed view is a history list, not a queue. Derived
  // per render from two columns that already ride along on the row — no store, selector, filter
  // or query reads them.
  const origin = isInboxRow ? classificationOrigin(node) : null;

  // The completion exit: the once-only mutation fire, the navigate-away fallback, and the
  // collapse-end commit, encapsulated. Begin plays the animation (or commits immediately under
  // reduced motion); the collapse wrapper's onTransitionEnd commits.
  const {
    isExiting: isCompleting,
    begin: beginComplete,
    onCollapseEnd: handleCompleteCollapseEnd,
  } = useAnimatedRowExit(() => completeTask(node.id), prefersReducedMotion);

  // The deletion exit: the same animate-then-commit mechanism, so the row fades out and its
  // height collapses (pulling the surrounding rows up) before `deleteTask` filters it out of
  // the store. Reduced motion commits straight away (no collapse to wait on).
  const {
    isExiting: isDeleting,
    begin: beginDelete,
    onCollapseEnd: handleDeleteCollapseEnd,
  } = useAnimatedRowExit(() => deleteTask(node.id), prefersReducedMotion);

  // Either exit collapses the row to nothing; the deletion additionally fades the whole row out.
  const isExiting = isCompleting || isDeleting;

  // Only one inline input may be open across all rows, so the title-edit and add-subtask
  // flags are derived from the shared active-editor store, not held per-row. Opening
  // either here closes whatever input another row had open (see active-editor-store).
  const isEditingTitle = sameEditor(activeEditor, { itemId: node.id, kind: 'title' });
  const showAddSubtask = sameEditor(activeEditor, { itemId: node.id, kind: 'subtask' });

  // The inline add-subtask field animates in (height-grow + fade) and back out (ALF-66), so it
  // must stay mounted through its exit — otherwise the unmount kills the animation. Derive the
  // render flag from `showAddSubtask` DURING RENDER (React's recommended pattern over a
  // setState-in-effect): mount as soon as it opens, and — under reduced motion, where there is no
  // animation to wait on — unmount immediately on close. The animated path unmounts on the
  // reveal's onExited. This flag also keeps the subtask container (below) alive through the exit
  // for a childless task, where `hasChildren` can't.
  const [addSubtaskRendered, setAddSubtaskRendered] = React.useState(showAddSubtask);
  if (showAddSubtask && !addSubtaskRendered) {
    setAddSubtaskRendered(true);
  } else if (!showAddSubtask && addSubtaskRendered && prefersReducedMotion) {
    setAddSubtaskRendered(false);
  }
  // The title's draft + trim/no-op/rollback save run through the shared useInlineEdit machine;
  // the EDIT-MODE flag stays in the cross-row active-editor store (so opening one row's title
  // closes any other's — the single-open-editor invariant). We therefore drive only the draft
  // and `save()` from the hook and ignore its own isEditing/begin/cancel. The shared
  // InlineEditField (rendered while isEditingTitle is true) owns focus + Enter/Escape/outside
  // dismiss; selectAllOnEdit:false keeps the focus-without-select behavior (no selectAllOnFocus).
  const titleEdit = useInlineEdit(node.title, (next) => updateTask(node.id, { title: next }), {
    selectAllOnEdit: false,
  });
  const { draft: draftTitle, setDraft: setDraftTitle } = titleEdit;

  // The epic gate (ALF-129): converts this 1-deep parent into a new epic + its ordered
  // stories. Opens only when no intended project decides the target — otherwise the
  // conversion fires straight from the menu (see handleConvertToEpic).
  const [showEpicGate, setShowEpicGate] = React.useState(false);
  const { convertToCodeEpic, convertTaskToCode } = useCodeActions();

  const canDrag = !isCompleted && !isTempId(node.id);
  const {
    setNodeRef: setDragNodeRef,
    listeners: dragListeners,
    isDragging,
  } = useDraggable({ id: node.id, disabled: !canDrag });

  // The row is also a drop target: dropping another task onto it re-parents that task here.
  // EVERY reconciled row stays a *registered* droppable — never `disabled`. A disabled
  // droppable doesn't just refuse the drop, it drops out of collision detection, so
  // releasing on it makes dnd-kit report the previously-hovered row as `over` instead.
  // That stale target silently re-parents the item onto the wrong task (the
  // "drop-on-self-after-highlighting-another vanishes the item" bug). Keeping the row
  // registered makes `over` always reflect the row actually under the pointer; whether the
  // drop is *allowed* is decided in the drag-end handler (see resolveReparent + the
  // reparentTask cycle guard).
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: node.id });

  // A global-search task selection scrolls this row in and rings it briefly (static under
  // reduced motion). The ref is merged onto the row element below.
  const { ref: highlightRef, highlighted: isSearchHighlighted } =
    useFocusItemHighlight<HTMLDivElement>(node.id);

  // Merge the draggable + droppable + search-highlight refs onto the one row element (the dnd
  // refs share node.id — dnd-kit keeps draggables and droppables in separate registries, so
  // this is safe).
  const setRowRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDragNodeRef(element);
      setDropNodeRef(element);
      highlightRef.current = element;
    },
    [setDragNodeRef, setDropNodeRef, highlightRef],
  );

  // A valid drop target lights up and swaps its checkbox for a "+" while a task hovers it.
  const isDropTarget = isOver && isValidDropTarget;

  // A just-captured row enters with a height-expand + fade/slide-from-above (ALF-20), pushing
  // the rows below it down. The trigger is the optimistic temp id: a row carries one only
  // between its insert and the server reconcile, so exactly the freshly-added rows animate —
  // a top-level capture, a new subtask, or a recurring task's next occurrence. Rows seeded
  // from the server (a page load, a view switch) already have real ids, so they never animate.
  // On reconcile the temp id is swapped for the real one, remounting the row at its rested
  // height, which also ends the one-shot entrance.
  const isEntering = isTempId(node.id);

  const hasChildren = node.children.length > 0;
  const descendantCount = getDescendantIds(node).length;
  // The checkbox reads as "complete" both for a completed row and during the exit
  // animation, so its fill + check icon appear the instant completion begins.
  const showAsComplete = isCompleted || isCompleting;

  // The card boundary is drawn exactly once, at a top-level (depth-0) node, enclosing the row
  // body AND its subtree — so subtasks sit inside the parent's card, never as cards of their own.
  const isCard = depth === 0;

  // In the Completed view every child is itself completed and renders inline (unchanged).
  // In an active view, completed children are split out and tucked behind a "Show completed"
  // toggle, separate from the active children shown directly above them.
  const activeChildren = isCompletedView
    ? node.children
    : node.children.filter((child) => child.status === 'active');
  const completedChildren = isCompletedView
    ? []
    : node.children.filter((child) => child.status === 'completed');

  // On the Completed screen, each root row carries a context label showing where the
  // task lives: its ancestor breadcrumb (oldest → youngest) when it's a nested subtask,
  // otherwise its RESIDENT folder name (or "Inbox" — including for a task that carries a
  // folder but was never dispatched). Ancestors are resolved from the full task
  // list because they may be active items filtered out of the completed view.
  const isContextRow = isCompletedView && depth === 0;
  const ancestorTitles = React.useMemo(
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — when isContextRow=false the false branch [] is never consumed (contextLabel is null, ancestorTitles.length is never checked); replacing with ["Stryker was here"] is behaviorally identical.
    () => (isContextRow ? getAncestorTitles(allTasks, node.parent_id) : []),
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — constant dep-array literal; every element is Object.is-equal across renders so React never recomputes, identical to [].
    [isContextRow, allTasks, node.parent_id],
  );
  const contextFolderId = residentFolderId(node);
  const contextLabel = isContextRow
    ? ancestorTitles.length > 0
      ? ancestorTitles.join(' > ')
      : contextFolderId
        ? (folders.find((f) => f.id === contextFolderId)?.name ?? 'Unknown')
        : 'Inbox'
    : null;

  const { rowLeft: indentLeft, metaLeft: metaIndentLeft } = useIndentation(depth);

  // All mutations go through the optimistic tasks store: the change shows instantly
  // and the store reconciles with the server (rolling back — which remounts this row —
  // on failure). No router.refresh(), no local dismiss/pending state.

  const handleToggleComplete = () => {
    // The cascade modal only warns about work it will actually change — subtasks that are
    // still active and about to be swept complete. If every descendant is already completed
    // (or there are none), completing the parent cascades nothing new, so skip it (ALF-73).
    if (hasActiveDescendant(node)) {
      setShowCascadeModal(true);
      return;
    }
    beginComplete();
  };

  const handleCascadeConfirm = () => {
    setShowCascadeModal(false);
    beginComplete();
  };

  const handleToggleUncomplete = async () => {
    try {
      await uncompleteTask(node.id);
    } catch {
      // The store already restored the row.
    }
  };

  const handleSaveTitle = async () => {
    // Exit edit mode immediately so the optimistic title shows the instant the user submits —
    // without waiting for the server. The active-editor store owns the edit-mode flag (closed
    // here in every case); useInlineEdit.save() then trims, no-ops on empty/unchanged, awaits
    // updateTask, and rolls the draft back on throw (the store rolls the row back underneath).
    closeEditor({ itemId: node.id, kind: 'title' });
    await titleEdit.save();
  };

  // The detail panel's Due chip auto-saves on every pick. Setting a date is a bare patch;
  // clearing it also clears any recurrence rule (a rule has nowhere to anchor without a due date).
  const handleSelectDueDate = async (iso: string) => {
    if (iso === (node.due_date ?? '')) return;
    try {
      await updateTask(node.id, { due_date: iso });
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleClearDueDate = async () => {
    if (node.due_date === null) return;
    try {
      await (node.recurrence === null
        ? updateTask(node.id, { due_date: null })
        : updateTask(node.id, { due_date: null, recurrence: null }));
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleSaveRecurrence = async (rule: RecurrenceRule | null, anchorDate: string) => {
    try {
      // Setting a rule requires an anchor due date: when the task has none, stamp the anchor
      // (default today) in the same patch.
      await updateTask(node.id, {
        recurrence: rule,
        ...(rule !== null && node.due_date === null && { due_date: anchorDate }),
      });
    } catch {
      // The store already rolled the row back.
    }
  };

  // The detail panel's notes editor auto-saves on blur, handing back the raw text. Trim, no-op on
  // an unchanged value, and clear with null when emptied.
  const handleCommitNotes = async (value: string) => {
    const newValue = value.trim();
    if (newValue === (node.notes ?? '')) return;
    try {
      await updateTask(node.id, { notes: newValue === '' ? null : newValue });
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleMoveToFolder = async (targetFolderId?: string) => {
    try {
      // undefined target = move to the Inbox (folder_id null).
      await moveTask(node.id, targetFolderId ?? null);
    } catch {
      // The store already restored the subtree.
    }
  };

  // Deletion is animated: beginDelete plays the fade + height collapse and only fires
  // deleteTask once the collapse ends (the store rolls the row back on failure). Under
  // reduced motion it commits immediately. See useAnimatedRowExit.

  const handleClassify = async (itemType: 'task' | 'code') => {
    try {
      await classifyItem(node.id, itemType);
    } catch {
      // The store already rolled the item_type back.
    }
  };

  const handleSavePriority = async (next: ItemNode['priority']) => {
    try {
      await updateTask(node.id, { priority: next });
    } catch {
      // The store already rolled the row back.
    }
  };

  // The three label writes (folder / project / epic), shared by the row chips and the detail
  // panel — one picker, one store action, whichever surface it's edited from. Each no-ops on
  // an unchanged pick, like the due-date handler above.
  const handleSetFolder = async (folderId: string | null) => {
    if (folderId === node.folder_id) return;
    try {
      await setFolder(node.id, folderId);
    } catch {
      // The store already rolled the subtree back.
    }
  };

  const handleSetProject = async (projectId: string | null) => {
    if (projectId === node.intended_project_id) return;
    try {
      await setIntendedProject(node.id, projectId);
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleSetEpic = async (epicId: string | null) => {
    if (epicId === node.intended_epic_id) return;
    try {
      await setIntendedEpic(node.id, epicId);
    } catch {
      // The store already rolled the row back.
    }
  };

  // The one editing-handler bundle the metadata cluster takes — present on the ordinary row,
  // omitted in select mode (where the chips render inert).
  const metaEditing = {
    onSelectDueDate: (iso: string) => {
      void handleSelectDueDate(iso);
    },
    onClearDueDate: () => {
      void handleClearDueDate();
    },
    onChangePriority: (next: TaskPriority | null) => {
      void handleSavePriority(next);
    },
    onSetFolder: (folderId: string | null) => {
      void handleSetFolder(folderId);
    },
    onSetProject: (projectId: string | null) => {
      void handleSetProject(projectId);
    },
    onSetEpic: (epicId: string | null) => {
      void handleSetEpic(epicId);
    },
  };

  // Open the inline add-subtask field: mark this row's subtask editor active (closing any other
  // row's open input) and expand the subtree, since the form renders inside it. Shared by the
  // desktop "+" button and the mobile ⋯-menu "Add subtask" item (ALF-118). Unlike the "+" button
  // this only opens (never toggles) — the menu closes on select, so there's nothing to toggle off.
  const handleOpenAddSubtask = () => {
    openEditor({ itemId: node.id, kind: 'subtask' });
    expandSubtasks(node.id);
    // The detail panel and the entry field both render between the row body and its subtask
    // list, so leaving both open buries the field under the panel — they're mutually exclusive
    // on a row (ALF-128). Only THIS row's panel: another row's is already gone, dismissed by
    // the outside pointer press. Nothing typed is lost — the panel commits its pending notes on
    // unmount.
    closeDetails(node.id);
  };

  // The epic conversion (ALF-129). The parent's active children in display order become the
  // stories; the epic gate's preview and the immediate path both consume this list.
  const epicChildItems = activeChildren.map((child) => ({
    id: child.id,
    title: child.title,
    notes: child.notes,
    source_url: child.source_url,
  }));
  // The RPC needs real ids — disable the epic actions while any row in the group is still an
  // unreconciled temp id (the same guard canDrag applies).
  const groupHasTempIds = isTempId(node.id) || node.children.some((child) => isTempId(child.id));

  // Settle the conversion: the children have left task_items and the parent is consumed —
  // deleted for a code row, completed for a task (its history stays). Toast deep-links to the
  // project board (the same toast-with-href seam the story gate uses).
  const handleEpicComplete = (result: ConvertedEpic) => {
    settleEpicConversion({
      parentId: node.id,
      childIds: result.stories.map((story) => story.item_id),
      parentOutcome: isCode ? 'removed' : 'completed',
    });
    const count = result.stories.length;
    showToast(
      `Created ${result.epic.ref} · ${String(count)} ${count === 1 ? 'story' : 'stories'}`,
      'default',
      projectBoardHref(result.epic.project_id),
    );
  };

  // A code parent captured with a project prefix converts immediately — no dialog; without one
  // the project-only epic gate opens and asks. Reached only through Dispatch (ALF-185).
  const handleConvertToEpic = () => {
    const intendedProjectId = node.intended_project_id;
    if (isCodeParent && intendedProjectId !== null) {
      void (async () => {
        try {
          const result = await convertToCodeEpic(
            { id: node.id, title: node.title, notes: node.notes },
            epicChildItems,
            intendedProjectId,
          );
          handleEpicComplete(result);
        } catch {
          // The code store already rolled the optimistic epic + stories back and toasted.
        }
      })();
      return;
    }
    setShowEpicGate(true);
  };

  // What this row's Dispatch does, or null when the row offers none: only an Inbox row — a
  // top-level item a human hasn't triaged yet — has a destination to be sent to. A subtask's
  // residency travels with its root, and a dispatched row has already gone.
  const dispatchAction = isInboxRow
    ? rowDispatchAction(node, { hasChildren: node.children.length > 0, groupHasTempIds })
    : null;

  // Dispatch (ALF-185): send this row where its labels already say it goes. An epic-shaped code
  // row runs the conversion above; every other ready row goes through the SAME store action the
  // bulk bar presses, on a set of one — the subtree residency cascade, the factory RPC, the
  // rollback and the failure toast are all its, so the two surfaces can't drift. The success
  // toast is the row's own, since here there IS a single destination to name and link to.
  const handleDispatch = () => {
    if (dispatchAction === null || dispatchAction.kind === 'blocked') return;
    if (dispatchAction.kind === 'epic') {
      handleConvertToEpic();
      return;
    }
    void (async () => {
      // The allocated story is caught on its way through, so a code dispatch can still announce
      // its ref and deep-link to the board — what the gate's own toast used to do.
      let story: CodeStory | undefined;
      const staying = await dispatchItems([node.id], async (item, projectId, epicId) => {
        story = await convertTaskToCode(item, projectId, epicId);
        return story;
      });
      // A failure keeps the row where it is and has already toasted; nothing to announce.
      if (staying.length > 0) return;
      if (story === undefined) {
        // A task: it landed in the folder its chip named, and the toast links to that view.
        const folder = folders.find((candidate) => candidate.id === node.folder_id);
        showToast(
          folder === undefined ? 'Dispatched' : `Dispatched to ${folder.name}`,
          'default',
          folder === undefined ? undefined : `/folders/${folder.id}`,
        );
        return;
      }
      const ref = story.ref ?? '';
      const projectId = story.project_id;
      showToast(
        `Created ${ref}`,
        'default',
        projectId === null ? undefined : storyBoardHref(projectId, ref),
      );
    })();
  };

  // "Move up" / "Move down" (ALF-117) — the keyboard/screen-reader-friendly reorder path.
  const {
    isActiveSubtask,
    canMoveUp,
    canMoveDown,
    moveUp: handleMoveUp,
    moveDown: handleMoveDown,
  } = useSubtaskReorder(node, isCompleted, isCompletedView);

  // Select mode: the whole row is one toggle button — its leading control becomes a selection
  // checkbox and clicking anywhere flips membership. Inline edit, expand, the drag handle and
  // the "More actions" menu are all suppressed so the row has exactly one meaning, and the
  // subtree is hidden (only root Inbox rows are selectable). A selected row gets the teal ring.
  // The metadata cluster stays — it is the state you dispatch from, so the labels the decision
  // rests on must be visible — but INERT (no `editing`): a chip inside this one <button> can't
  // be a button of its own, and a click here means "toggle selection", nothing else.
  if (inSelectMode) {
    return (
      <li className="group/row list-none">
        <Button
          variant="ghost"
          onClick={() => {
            toggleSelection(node.id);
          }}
          aria-pressed={isSelected}
          aria-label={`${isSelected ? 'Deselect' : 'Select'} "${node.title}"`}
          className={cn(
            // Reset the Button atom's centred, fixed-height chrome into a full-width row.
            'h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal',
            isSelected && 'bg-accent-teal/5 ring-2 ring-inset ring-accent-teal',
          )}
          style={{ paddingLeft: indentLeft }}
        >
          <span
            aria-hidden="true"
            className={cn(
              checkboxSizeClass,
              'flex items-center justify-center rounded border',
              isSelected ? 'border-accent-teal bg-accent-teal' : checkboxIncompleteClass,
            )}
          >
            {isSelected && <Check size={10} className="text-background" strokeWidth={3} />}
          </span>
          {/* Title + provenance travel together in one flex-1 box, with the mark as the title's
            SIBLING rather than its content. The title here is a single clipped `truncate` line,
            so a mark nested inside it would be part of the overflowing content and any title
            long enough to ellipsize would swallow it — in the one mode where you are choosing
            what to dispatch. Outside it, the mark always renders; inside a shared box that
            shrink-wraps the pair, it sits against the text (or the ellipsis) instead of drifting
            to the row's far edge on a short title, where it would read as one more badge. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-foreground">{node.title}</span>
            {origin !== null && <ClassificationMark origin={origin} />}
          </span>
          <RowMetaCluster
            node={node}
            isTask={isTask}
            isTopLevelTask={isTopLevelTask}
            recurrenceRule={recurrenceRule}
            showTypeBadge={showTypeBadge}
            isCompletedView={isCompletedView}
          />
        </Button>
      </li>
    );
  }

  return (
    <li
      ref={rowContainerRef}
      className={cn(
        'group/row list-none',
        (reorderGap !== undefined || reorderGapBelow !== undefined) && 'relative',
      )}
    >
      {/* Reorder gap strips (ALF-117) — absolutely positioned over this row's top edge (and the
        bottom edge, on the last active sibling), so they add no flow height and never reflow the
        list. Only present on active subtask rows in an active view. */}
      {reorderGap && (
        <SubtaskGap
          parentId={reorderGap.parentId}
          index={reorderGap.index}
          depth={depth}
          edge="top"
        />
      )}
      {reorderGapBelow && (
        <SubtaskGap
          parentId={reorderGapBelow.parentId}
          index={reorderGapBelow.index}
          depth={depth}
          edge="bottom"
        />
      )}
      {/* A freshly-captured row grows in from 0 height and slides down from above, pushing
          the rows below it down (ALF-20). For an existing row this wrapper is a no-op
          passthrough. */}
      <AnimatedHeightEnter entering={isEntering}>
        {/* Both exits (complete + delete) collapse the row (and its expanded subtree): a
          transition on the grid row track from 1fr to 0fr shrinks the height to nothing,
          pulling the rows below up. `ease-out` (a transition, not a keyframe) makes the
          collapse start briskly, then settle. Completion uses `collapseClass` (delay-200 holds
          the collapse back until the 200ms checkbox pop finishes); deletion uses
          `deleteCollapseClass` (no delay — nothing to wait on) and fades the whole row out via
          `deleteFadeClass` on the clipped inner child. The inner child is clipped so it can
          shrink past its content. Kept bespoke (not AnimatedHeightCollapse) for the 300ms
          timing and the commit-on-end contract. Both exits' onTransitionEnd handlers run; each
          only acts on its own `grid-template-rows` transition while its flag is set. */}
        <div
          className={cn(
            isDeleting ? deleteCollapseClass : collapseClass,
            isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
          data-testid="task-collapse"
          onTransitionEnd={(event) => {
            handleCompleteCollapseEnd(event);
            handleDeleteCollapseEnd(event);
          }}
        >
          <div
            className={cn(
              // The grid item inside the collapse track must be able to shrink below its
              // content's min-content, otherwise the nowrap notes preview forces the card past
              // the viewport and the preview never truncates on mobile (ALF-99).
              collapseInnerClass,
              // At depth 0 this wrapper — which encloses both the row body and the subtree
              // <ul> — carries the mobile card chrome, so the whole subtree lives inside one
              // card (md+ dissolves it back into the shared divide-y list).
              isCard && cardChromeClass,
              isExiting && 'overflow-hidden',
              isDeleting && cn(deleteFadeClass, 'opacity-0'),
            )}
          >
            {/* Main row — the whole surface is the drag handle (the row sensors let the
              buttons/input below stay clickable). Dropping another task here re-parents it. */}
            <div
              ref={setRowRef}
              {...(dragListeners ?? {})}
              data-drop-over={isDropTarget ? 'true' : undefined}
              className={cn(
                rowBaseClass,
                // A valid drop target lights up (teal); otherwise the usual hover wash.
                isDropTarget ? rowDropTargetClass : rowHoverClass,
                // Dim the in-place row while its DragOverlay clone is being dragged.
                isDragging && 'opacity-40',
                // A search-selected row rings briefly, then the ring fades out.
                'transition-shadow duration-700 motion-reduce:transition-none',
                isSearchHighlighted && 'ring-2 ring-inset ring-accent-teal',
              )}
              style={{ paddingLeft: indentLeft }}
            >
              {/* Expand/collapse toggle */}
              <IconButton
                size="sm"
                onClick={() => {
                  toggleSubtasks(node.id);
                }}
                aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
                aria-expanded={isExpanded}
                className={cn(
                  chevronButtonClass,
                  mobileTapClass,
                  // No children → drop the chevron column on mobile entirely so the title shifts
                  // left (no reserved space); md+ keeps an invisible spacer so titles stay
                  // aligned across rows.
                  !hasChildren && 'hidden md:inline-flex md:invisible md:pointer-events-none',
                )}
              >
                <ChevronRight
                  size={14}
                  className={cn(
                    chevronIconClass,
                    // Enlarged glyph on mobile (16px), today's 14px at md+.
                    'h-4 w-4 md:h-3.5 md:w-3.5',
                    isExpanded && 'rotate-90',
                  )}
                />
              </IconButton>

              {/* Completion is `task`-only: an unclassified/code row shows no checkbox,
                just a spacer so its title stays aligned with task rows. */}
              {isTask ? (
                isDropTarget ? (
                  <div aria-hidden="true" className={dropPlusClass}>
                    <Plus size={10} strokeWidth={3} />
                  </div>
                ) : (
                  <CheckboxButton
                    onClick={() => {
                      if (isCompleting) return;
                      if (isCompleted) {
                        void handleToggleUncomplete();
                      } else {
                        handleToggleComplete();
                      }
                    }}
                    aria-label={
                      isCompleted ? `Mark "${node.title}" active` : `Mark "${node.title}" complete`
                    }
                    className={cn(
                      checkboxSizeClass,
                      mobileTapClass,
                      showAsComplete
                        ? 'bg-accent-teal border-accent-teal'
                        : checkboxIncompleteClass,
                      // The snappy press: a quick scale overshoot the instant completion begins.
                      isCompleting && 'animate-check-pop motion-reduce:animate-none',
                    )}
                  >
                    {showAsComplete && (
                      <Check
                        size={10}
                        // Scale the check with the enlarged mobile box (14px), 10px at md+.
                        className="h-3.5 w-3.5 text-background md:h-2.5 md:w-2.5"
                        strokeWidth={3}
                      />
                    )}
                  </CheckboxButton>
                ) /* Completion checkbox — or, while a task is dropped onto this row, a "+" that
                signals it will become a child here (replaces the checkbox; no animation). */
              ) : (
                // Unclassified/code rows have no checkbox: drop the alignment spacer on mobile so
                // the title reclaims the column; md+ keeps it so titles stay aligned with
                // checkboxed task rows.
                <div
                  className={cn(checkboxSizeClass, 'shrink-0', 'hidden md:block')}
                  aria-hidden="true"
                  data-testid="checkbox-spacer"
                />
              )}

              {/* Title + metadata share one column on mobile so the leading controls
                (chevron / checkbox) and the trailing actions centre against the WHOLE card
                height, not the title's first line. `display:contents` at md+ dissolves the
                column back into today's single inline line. */}
              <div className={rowContentColClass}>
                {/* Title */}
                {isEditingTitle ? (
                  <InlineEditField
                    value={draftTitle}
                    onChange={setDraftTitle}
                    onSubmit={() => {
                      void handleSaveTitle();
                    }}
                    onCancel={() => {
                      setDraftTitle(node.title);
                      closeEditor({ itemId: node.id, kind: 'title' });
                    }}
                    confirmLabel="Confirm title"
                    inputLabel="Edit title"
                    requireValue={false}
                    dissolveIntoGrid
                    inputClassName={titleInputClass}
                    confirmClassName={confirmTitleClass}
                  />
                ) : (
                  <div
                    // select-none: the whole row is a drag surface, so the title text is no
                    // longer highlightable. Double-click still opens the inline title editor.
                    className="flex-1 flex flex-col min-w-0 select-none"
                    onDoubleClick={() => {
                      // Reset the draft so a previously-abandoned edit doesn't resurface.
                      setDraftTitle(node.title);
                      openEditor({ itemId: node.id, kind: 'title' });
                    }}
                  >
                    <span
                      className={cn(
                        // delay-200 keeps the dismissal (fade + collapse) one beat behind the pop.
                        titleTextClass,
                        // Fade to low-contrast as the row completes; a completed row reads
                        // low-contrast; an active row full-contrast.
                        isCompleting
                          ? 'text-muted-foreground/50'
                          : isCompleted
                            ? 'text-muted-foreground'
                            : 'text-foreground',
                      )}
                    >
                      {node.title}
                      {/* Provenance — INSIDE the title span, glued to the last word by a
                        non-breaking space. Appended as a plain sibling of the span the glyph
                        would be its own inline box with a break opportunity in front of it, so a
                        title that fills its final line to the edge would drop the mark onto a
                        line of its own — a lone glyph floating under the row, which nothing else
                        in the app does. The nbsp removes that break opportunity, so the mark
                        always travels with the final word. */}
                      {origin !== null && (
                        <>
                          {'\u00A0'}
                          <ClassificationMark origin={origin} />
                        </>
                      )}
                    </span>
                    {/* Notes preview — a single muted line beneath the title when notes exist,
                    so the row stays scannable without opening the detail (ALF-67 §2). Clipped to
                    one line with an ellipsis (see notesPreviewClass); the ancestor min-w-0 chain
                    keeps it bounded so it truncates on mobile too (ALF-99). */}
                    {node.notes !== null && node.notes !== '' && (
                      <span data-testid="task-notes-preview" className={notesPreviewClass}>
                        {node.notes}
                      </span>
                    )}
                    {contextLabel !== null && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                        <ListCheck size={10} className="shrink-0" />
                        <span className="truncate">{contextLabel}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Metadata cluster (Type → Folder → Project → Epic → Due → Repeat → Priority →
                Subtask count) — the shared RowMetaCluster, interactive here: every label chip is
                clickable in place, opening the same picker its detail-panel twin does. On mobile
                it sits on its own line *below* the title inside the shared content column (so a
                long title isn't squeezed by the badges); at md+ `display:contents` dissolves the
                wrapper and the badges sit inline to the title's right, exactly as today. */}
                <RowMetaCluster
                  node={node}
                  isTask={isTask}
                  isTopLevelTask={isTopLevelTask}
                  recurrenceRule={recurrenceRule}
                  showTypeBadge={showTypeBadge}
                  isCompletedView={isCompletedView}
                  editing={metaEditing}
                />
              </div>

              {/* Row actions — always visible on mobile, hover-revealed on md+ (ALF-88). */}
              <div className={rowActionsClass}>
                {/* Add subtask / Add story — any task, or a code ROOT (an epic under
                  construction adds its stories here). A code child shows no affordance, so
                  the 1-deep rule has no UI path to violate. */}
                {canAddSubtask && (
                  <IconButton
                    size="md"
                    tone="accent"
                    // Desktop-only: on mobile the "+" collapses into the ⋯ menu's "Add subtask"
                    // item (ALF-118), so hide it below `md` and keep only the dot menu there.
                    className={addSubtaskButtonClass}
                    onMouseDown={(e) => {
                      // Prevent the browser from moving focus away from the CaptureBox input
                      // when the toggle is pressed while the box is open. Without this, `blur`
                      // fires and `onDismiss` closes the box before the `click` handler runs,
                      // making the handler see showAddSubtask=false and re-open instead of close.
                      if (showAddSubtask) e.preventDefault();
                    }}
                    onClick={() => {
                      if (showAddSubtask) {
                        closeEditor({ itemId: node.id, kind: 'subtask' });
                      } else {
                        handleOpenAddSubtask();
                      }
                    }}
                    aria-label={isCode ? 'Add story' : 'Add subtask'}
                  >
                    {/* Enlarged glyph on mobile (16px) for a comfier touch target; today's 12px
                      at md+. */}
                    <Plus size={12} className="h-4 w-4 md:h-3 md:w-3" />
                  </IconButton>
                )}

                {/* More actions dropdown — all visibility conditionals live inside it. */}
                <TaskRowMenu
                  canChangeType={canChangeType}
                  isCode={isCode}
                  canAddSubtask={canAddSubtask}
                  dispatch={dispatchAction}
                  folders={folders}
                  canMoveToFolder={isDispatched(node)}
                  canMoveUp={isActiveSubtask && canMoveUp}
                  canMoveDown={isActiveSubtask && canMoveDown}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onAddSubtask={handleOpenAddSubtask}
                  onOpenDetails={() => {
                    toggleDetails(node.id);
                  }}
                  onClassify={(itemType) => {
                    void handleClassify(itemType);
                  }}
                  onDispatch={handleDispatch}
                  onMoveToFolder={(targetFolderId) => {
                    void handleMoveToFolder(targetFolderId);
                  }}
                  onDelete={beginDelete}
                />
              </div>
            </div>

            {/* Inline detail panel ("Open details") — the auto-saving chip row + notes. Sits
              between the row and the subtask list (row → detail → subtasks). */}
            {isDetailOpen && (
              <TaskDetailPanel
                node={node}
                metaLeft={metaIndentLeft}
                isTask={isTask}
                isCode={isCode}
                showRepeat={isTopLevelTask}
                recurrence={recurrenceRule}
                onChangeRecurrence={(rule, anchorDate) => {
                  void handleSaveRecurrence(rule, anchorDate);
                }}
                onSelectDueDate={(iso) => {
                  void handleSelectDueDate(iso);
                }}
                onClearDueDate={() => {
                  void handleClearDueDate();
                }}
                onChangePriority={(next) => {
                  void handleSavePriority(next);
                }}
                onSetFolder={(folderId) => {
                  void handleSetFolder(folderId);
                }}
                onSetProject={(projectId) => {
                  void handleSetProject(projectId);
                }}
                onSetEpic={(epicId) => {
                  void handleSetEpic(epicId);
                }}
                onCommitNotes={(value) => {
                  void handleCommitNotes(value);
                }}
              />
            )}

            {/* Children — grid-rows trick gives a CSS-only height transition from 0fr→1fr.
              The container stays mounted while the add-subtask field animates out (the lifted
              `addSubtaskRendered` flag), so a childless row's field can finish its exit. */}
            {(hasChildren || addSubtaskRendered) && (
              <AnimatedHeightCollapse
                open={isExpanded}
                className={cn(
                  'transition-opacity motion-reduce:transition-none',
                  isExpanded ? 'opacity-100 duration-200 delay-75' : 'opacity-0 duration-100',
                )}
              >
                <ul aria-label="Subtasks" className={subtreeClass}>
                  {/* Add subtask inline form — grows in and fades, shrinks out on dismiss (ALF-66).
                    Kept mounted through the exit by `addSubtaskRendered`; the reveal's onExited
                    drops it once the collapse animation ends. */}
                  {addSubtaskRendered && (
                    <li
                      className="list-none"
                      style={{ paddingLeft: `${String((depth + 1) * 1.25 + 2.5)}rem` }}
                    >
                      <AnimatedHeightReveal
                        open={showAddSubtask}
                        onExited={() => {
                          setAddSubtaskRendered(false);
                        }}
                        className={captureRevealClass}
                      >
                        <CaptureBox
                          parentId={node.id}
                          folderId={node.folder_id}
                          compact
                          placeholder={isCode ? 'Add story…' : 'Add subtask…'}
                          onDismiss={() => {
                            closeEditor({ itemId: node.id, kind: 'subtask' });
                          }}
                        />
                      </AnimatedHeightReveal>
                    </li>
                  )}

                  {/* Active child rows. In an active view each row hosts reorder gap strips
                    (ALF-117): one above every row and one below the last (one more gap than rows),
                    so a subtask can be dragged into the slot between siblings. The gaps live inside
                    each row's <li> (see reorderGap below), NOT as list items here, so they don't
                    disturb the mobile divide-y separators. The Completed view offers no reordering,
                    so it passes no gaps. */}
                  {activeChildren.map((child, index) =>
                    isCompletedView ? (
                      <TaskRow key={child.id} node={child} depth={depth + 1} isCompletedView />
                    ) : (
                      <TaskRow
                        key={child.id}
                        node={child}
                        depth={depth + 1}
                        reorderGap={{ parentId: node.id, index }}
                        reorderGapBelow={
                          index === activeChildren.length - 1
                            ? { parentId: node.id, index: index + 1 }
                            : undefined
                        }
                      />
                    ),
                  )}

                  {/* Completed children — revealed by the toggle with the same grid-rows
                    animation as the parent's own expand. The toggle sits at the bottom. */}
                  {completedChildren.length > 0 && (
                    <li className="list-none">
                      <AnimatedHeightCollapse
                        open={showCompleted}
                        className={cn(
                          'transition-opacity motion-reduce:transition-none',
                          showCompleted
                            ? 'opacity-100 duration-200 delay-75'
                            : 'opacity-0 duration-100',
                        )}
                      >
                        <ul aria-label="Completed subtasks">
                          {completedChildren.map((child) => (
                            <TaskRow
                              key={child.id}
                              node={child}
                              depth={depth + 1}
                              isCompletedView={isCompletedView}
                            />
                          ))}
                        </ul>
                      </AnimatedHeightCollapse>

                      <div
                        className="py-1"
                        style={{ paddingLeft: `${String((depth + 1) * 1.25 + 0.75)}rem` }}
                      >
                        <DisclosureToggle
                          variant="inline"
                          onClick={() => {
                            toggleCompleted(node.id);
                          }}
                          aria-expanded={showCompleted}
                        >
                          {showCompleted
                            ? 'Hide completed'
                            : `Show completed (${String(completedChildren.length)})`}
                        </DisclosureToggle>
                      </div>
                    </li>
                  )}
                </ul>
              </AnimatedHeightCollapse>
            )}
          </div>
        </div>
      </AnimatedHeightEnter>

      {/* Cascade completion modal */}
      <CascadeModal
        open={showCascadeModal}
        onOpenChange={setShowCascadeModal}
        taskTitle={node.title}
        subtaskCount={descendantCount}
        onConfirm={() => {
          handleCascadeConfirm();
        }}
        isPending={false}
      />

      {/* The epic gate (ALF-129) — where a code parent's Dispatch lands when no intended project
          decides the target: the project picker, plus the read-only preview of the epic (this
          row's title) and its ordered stories. */}
      <EpicGateDialog
        open={showEpicGate}
        onOpenChange={setShowEpicGate}
        parent={{ id: node.id, title: node.title, notes: node.notes }}
        childItems={epicChildItems}
        onComplete={handleEpicComplete}
      />
    </li>
  );
}
