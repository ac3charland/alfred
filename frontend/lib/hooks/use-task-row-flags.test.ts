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
  children: [],
};

const EMPTY: ReadonlySet<string> = new Set();

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

  describe('isValidDropTarget', () => {
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
