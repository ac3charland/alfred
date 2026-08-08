import type { ItemNode } from '@/lib/tree';
import { isTempId } from '@/lib/tree';
import type { Item } from '@/lib/types';

export interface TaskRowFlags {
  /**
   * A `task` row: completion and due dates are task-only — gated here in the UI and
   * structurally in the DB (the CHECK constraint).
   */
  isTask: boolean;
  /**
   * An `unclassified` row (what capture creates). The Classify-as submenu is inbox triage,
   * offered ONLY while still unclassified.
   */
  isUnclassified: boolean;
  /** A `code`-classified-but-not-yet-sent row — still in the inbox, offering the gate. */
  isCode: boolean;
  /**
   * Eligible for the gate's convert paths (a task or unclassified row, both safe to convert;
   * a `code` row uses "Send to Code module" instead). Renders BOTH "Convert to Code Story…"
   * and "Convert to Code Epic…", each individually enabled by the two flags below.
   */
  canConvert: boolean;
  /**
   * May host subtasks: any task, or a code ROOT (a code child never nests further — the
   * 1-deep rule, enforced here and by the DB trigger). Drives the desktop `+` and the mobile
   * "Add subtask" / "Add story" menu item.
   */
  canAddSubtask: boolean;
  /** A code root with ≥1 child — the epic under construction ("Send to Code module" converts it). */
  isCodeParent: boolean;
  /** A code child (a story-to-be) — reorders among code siblings, converts with its parent. */
  isCodeChild: boolean;
  /** "Convert to Code Story…" applies: a convertible row with no subtasks (a story is one item). */
  canConvertToStory: boolean;
  /**
   * "Convert to Code Epic…" applies: a task with ≥1 active child and no grandchildren (the
   * epic's stories must themselves be 1-deep leaves).
   */
  canConvertToEpic: boolean;
  /**
   * A valid drop target lights up: a different, active, reconciled task outside the dragged
   * item's own subtree (re-parenting onto self/a descendant would make a cycle). A non-`task`
   * row can never be a parent, and a `code` item never re-parents onto a task — the two
   * families don't mix by drag.
   */
  isValidDropTarget: boolean;
  /**
   * The type may be changed (the ⋯ menu's Classify as… / the bulk bar's): a top-level row with
   * no subtasks. The dangerous flip is a PARENT's — `enforce_subtask_shape` returns early on a
   * parentless row and never re-validates the untouched children, so a code root would silently
   * acquire task children; the database cannot catch that one, so the UI must. A subtask's flip
   * is caught by the DB, but the UI shouldn't offer it either.
   */
  canChangeType: boolean;
}

/**
 * Derives a task row's item-type flags and its drop-target validity from the node. These
 * conditionals gate nearly every affordance in the row (checkbox, due date, subtasks, the
 * menu entries, the drop highlight); centralising them keeps the row and its menu in sync.
 * `draggedItemType` is the in-flight drag's item type (null when nothing is dragged), so the
 * drop highlight can refuse a cross-family re-parent.
 */
export function useTaskRowFlags(
  node: ItemNode,
  isCompleted: boolean,
  draggedSubtreeIds: ReadonlySet<string>,
  draggedItemType: Item['item_type'] | null = null,
): TaskRowFlags {
  const isTask = node.item_type === 'task';
  const isUnclassified = node.item_type === 'unclassified';
  const isCode = node.item_type === 'code';
  const canConvert = isTask || isUnclassified;
  const isCodeRoot = isCode && node.parent_id === null;
  const canAddSubtask = isTask || isCodeRoot;
  const isCodeParent = isCodeRoot && node.children.length > 0;
  const isCodeChild = isCode && node.parent_id !== null;
  const canConvertToStory = canConvert && node.children.length === 0;
  const activeChildren = node.children.filter((child) => child.status === 'active');
  const canConvertToEpic =
    isTask &&
    activeChildren.length > 0 &&
    node.children.every((child) => child.children.length === 0);
  const isValidDropTarget =
    isTask &&
    !isCompleted &&
    !isTempId(node.id) &&
    !draggedSubtreeIds.has(node.id) &&
    draggedItemType !== 'code';
  const canChangeType = node.parent_id === null && node.children.length === 0;

  return {
    isTask,
    isUnclassified,
    isCode,
    canConvert,
    canAddSubtask,
    isCodeParent,
    isCodeChild,
    canConvertToStory,
    canConvertToEpic,
    isValidDropTarget,
    canChangeType,
  };
}
