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
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
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
    it('marks a task node isTask, and nothing else', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'task' }, false, EMPTY);
      expect(flags).toMatchObject({ isTask: true, isUnclassified: false, isCode: false });
    });

    it('marks an unclassified node isUnclassified', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY);
      expect(flags).toMatchObject({ isTask: false, isUnclassified: true, isCode: false });
    });

    it('marks a code node isCode', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY);
      expect(flags).toMatchObject({ isTask: false, isUnclassified: false, isCode: true });
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

    it('marks only a code ROOT with children isCodeParent', () => {
      const parent = {
        ...BASE_NODE,
        item_type: 'code' as const,
        children: [child({ item_type: 'code' })],
      };
      expect(useTaskRowFlags(parent, false, EMPTY).isCodeParent).toBe(true);
      // A nested code row is a story-to-be: it converts with its parent, never on its own.
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'code', parent_id: 'p' }, false, EMPTY)
          .isCodeParent,
      ).toBe(false);
      expect(useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY).isCodeParent).toBe(
        false,
      );
      // A TASK with children is not an epic under construction — its Dispatch files it.
      expect(
        useTaskRowFlags({ ...BASE_NODE, children: [child({})] }, false, EMPTY).isCodeParent,
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

  describe('canChangeType (ALF-170)', () => {
    it.each(['task', 'code', 'unclassified'] as const)(
      'is true for a childless %s root',
      (itemType) => {
        const { canChangeType } = useTaskRowFlags(
          { ...BASE_NODE, item_type: itemType },
          false,
          EMPTY,
        );
        expect(canChangeType).toBe(true);
      },
    );

    it('is false for a root with children — the flip the database cannot catch', () => {
      const { canChangeType } = useTaskRowFlags(
        { ...BASE_NODE, children: [child({})] },
        false,
        EMPTY,
      );
      expect(canChangeType).toBe(false);
    });

    it('is false for a subtask', () => {
      const { canChangeType } = useTaskRowFlags(child({}), false, EMPTY);
      expect(canChangeType).toBe(false);
    });
  });
});
