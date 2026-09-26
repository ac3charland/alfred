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
  weekly_plan_id: null,
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

    it('marks a knowledge node isKnowledge, and none of the others', () => {
      const flags = useTaskRowFlags({ ...BASE_NODE, item_type: 'knowledge' }, false, EMPTY);
      expect(flags).toMatchObject({
        isTask: false,
        isUnclassified: false,
        isCode: false,
        isKnowledge: true,
      });
    });

    it.each(['task', 'code', 'unclassified'] as const)(
      'does not mark a %s node isKnowledge',
      (itemType) => {
        const { isKnowledge } = useTaskRowFlags(
          { ...BASE_NODE, item_type: itemType },
          false,
          EMPTY,
        );
        expect(isKnowledge).toBe(false);
      },
    );
  });

  describe('canDrag', () => {
    it('lets an active, reconciled task or unclassified root lift', () => {
      expect(useTaskRowFlags(BASE_NODE, false, EMPTY).canDrag).toBe(true);
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'unclassified' }, false, EMPTY).canDrag,
      ).toBe(true);
    });

    it('keeps a completed row and a temp id still', () => {
      expect(useTaskRowFlags(BASE_NODE, true, EMPTY).canDrag).toBe(false);
      expect(useTaskRowFlags({ ...BASE_NODE, id: 'temp-abc' }, false, EMPTY).canDrag).toBe(false);
    });

    // A folder holds tasks: a drop there runs moveTask, which would file a code or knowledge
    // root like a task instead of sending it where its type says it goes.
    it('keeps a code root and a knowledge root still', () => {
      expect(useTaskRowFlags({ ...BASE_NODE, item_type: 'code' }, false, EMPTY).canDrag).toBe(
        false,
      );
      expect(useTaskRowFlags({ ...BASE_NODE, item_type: 'knowledge' }, false, EMPTY).canDrag).toBe(
        false,
      );
    });

    it('still lets a code child lift — reordering stories is a real gesture', () => {
      expect(useTaskRowFlags(child({ item_type: 'code' }), false, EMPTY).canDrag).toBe(true);
    });
  });

  describe('the subtask affordance', () => {
    it('lets a task and a code ROOT add subtasks, but not a code child, unclassified or knowledge row', () => {
      expect(
        useTaskRowFlags({ ...BASE_NODE, item_type: 'knowledge' }, false, EMPTY).canAddSubtask,
      ).toBe(false);
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
    it.each(['task', 'code', 'unclassified', 'knowledge'] as const)(
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
