import type { ItemNode } from '@/lib/tree';

import { useTaskRowFlags } from './use-task-row-flags';

const BASE_NODE: ItemNode = {
  id: 'item-1',
  title: 'Write tests',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  sort_order: 0,
  children: [],
};

const EMPTY: ReadonlySet<string> = new Set();

/** A child node of BASE_NODE (the epic-shape fixtures). */
const child = (overrides: Partial<ItemNode>): ItemNode => ({
  ...BASE_NODE,
  id: 'child-1',
  parent_id: 'item-1',
  ...overrides,
});

// The hook holds no state or effects — call it directly (it's a pure derivation).
describe('useTaskRowFlags', () => {
  describe('item-type flags', () => {
    it('marks a task node isTask, canConvert, and nothing else', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'task' }, false, EMPTY);
      expect(flags).toMatchObject({
        isTask: true,
        isUnclassified: false,
        isCode: false,
        canConvert: true,
      });
    });

    it('marks an unclassified node isUnclassified and canConvert', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY);
      expect(flags).toMatchObject({
        isTask: false,
        isUnclassified: true,
        isCode: false,
        canConvert: true,
      });
    });

    it('marks a code node isCode and NOT canConvert', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY);
      expect(flags).toMatchObject({
        isTask: false,
        isUnclassified: false,
        isCode: true,
        canConvert: false,
      });
    });
  });

  describe('subtask affordance + epic-shape flags (ALF-129)', () => {
    it('lets a task and a code ROOT add subtasks, but not a code child or unclassified row', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY).canAddSubtask).toBe(true);
      expect(useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY).canAddSubtask).toBe(
        true,
      );
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'code', parent_id: 'p' }, false, EMPTY)
          .canAddSubtask,
      ).toBe(false);
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY).canAddSubtask,
      ).toBe(false);
    });

    it('marks a code root with children isCodeParent, and a nested code row isCodeChild', () => {
      const parent = {
        ...BASE_NODE,
        item_type: 'code' as const,
        children: [child({ item_type: 'code' })],
      };
      expect(useTaskRowFlags(parent, false, EMPTY)).toMatchObject({
        isCodeParent: true,
        isCodeChild: false,
      });
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'code', parent_id: 'p' }, false, EMPTY),
      ).toMatchObject({ isCodeParent: false, isCodeChild: true });
      expect(useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY)).toMatchObject({
        isCodeParent: false,
        isCodeChild: false,
      });
    });

    it('enables Convert to Code Story only for a convertible row with no children', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY).canConvertToStory).toBe(true);
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY)
          .canConvertToStory,
      ).toBe(true);
      expect(
        useTaskRowFlags({ ...BASE_NODE, children: [child({})] }, false, EMPTY).canConvertToStory,
      ).toBe(false);
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY).canConvertToStory,
      ).toBe(false);
    });

    it('enables Convert to Code Epic for a task with ≥1 active child and no grandchildren', () => {
      expect(
        useTaskRowFlags({ ...BASE_NODE, children: [child({})] }, false, EMPTY).canConvertToEpic,
      ).toBe(true);
    });

    it('disables Convert to Code Epic with no children, only completed children, or grandchildren', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY).canConvertToEpic).toBe(false);
      expect(
        useTaskRowFlags({ ...BASE_NODE, children: [child({ status: 'completed' })] }, false, EMPTY)
          .canConvertToEpic,
      ).toBe(false);
      const withGrandchild = {
        ...BASE_NODE,
        children: [
          child({ children: [{ ...BASE_NODE, id: 'gc-1', parent_id: 'child-1', children: [] }] }),
        ],
      };
      expect(useTaskRowFlags(withGrandchild, false, EMPTY).canConvertToEpic).toBe(false);
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY).canConvertToEpic,
      ).toBe(false);
    });
  });

  describe('isValidDropTarget', () => {
    it('is false while a code item is being dragged (the families never mix)', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY, 'code').isValidDropTarget).toBe(false);
    });

    it('stays true while a task is being dragged', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY, 'task').isValidDropTarget).toBe(true);
    });

    it('is true for an active, reconciled task outside the dragged subtree', () => {
      const { isValidDropTarget } = useTaskRowFlags(BASE_NODE, false, EMPTY);
      expect(isValidDropTarget).toBe(true);
    });

    it('is false for a non-task row', () => {
      const { isValidDropTarget } = useTaskRowFlags(
        { ...BASE_NODE, item_type: 'unclassified' },
        false,
        EMPTY,
      );
      expect(isValidDropTarget).toBe(false);
    });

    it('is false for a completed row', () => {
      const { isValidDropTarget } = useTaskRowFlags(BASE_NODE, true, EMPTY);
      expect(isValidDropTarget).toBe(false);
    });

    it('is false for a temp (unreconciled) id', () => {
      const { isValidDropTarget } = useTaskRowFlags({ ...BASE_NODE, id: 'temp-abc' }, false, EMPTY);
      expect(isValidDropTarget).toBe(false);
    });

    it("is false when the node is inside the dragged item's own subtree", () => {
      const { isValidDropTarget } = useTaskRowFlags(BASE_NODE, false, new Set(['item-1']));
      expect(isValidDropTarget).toBe(false);
    });
  });
});
