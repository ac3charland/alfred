import type { ItemNode } from './tree';
import {
  TEMP_ID_PREFIX,
  buildTree,
  findNode,
  getDescendantIds,
  insertChild,
  insertRoot,
  insertSubtree,
  isTempId,
  makeOptimisticItem,
  removeNode,
  updateNode,
} from './tree';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  children: [],
};

function node(overrides: Partial<ItemNode>): ItemNode {
  return { ...BASE_NODE, children: [], ...overrides };
}

/** Narrow `T | undefined` to `T` without a cast or non-null assertion (both linted out). */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a defined value');
  return value;
}

/** A small forest: two roots; root-1 has two children, the first with a grandchild. */
function sampleForest(): ItemNode[] {
  const grandchild = node({ id: 'g-1', parent_id: 'c-1', created_at: '2025-01-04T00:00:00Z' });
  const child1 = node({
    id: 'c-1',
    parent_id: 'item-1',
    created_at: '2025-01-03T00:00:00Z',
    children: [grandchild],
  });
  const child2 = node({ id: 'c-2', parent_id: 'item-1', created_at: '2025-01-02T00:00:00Z' });
  const root1 = node({
    id: 'item-1',
    created_at: '2025-01-05T00:00:00Z',
    children: [child1, child2],
  });
  const root2 = node({ id: 'item-2', created_at: '2025-01-01T00:00:00Z' });
  return [root1, root2];
}

describe('isTempId', () => {
  it('recognises optimistic ids by prefix', () => {
    expect(isTempId(`${TEMP_ID_PREFIX}abc`)).toBe(true);
    expect(isTempId('item-1')).toBe(false);
  });
});

describe('findNode', () => {
  it('finds a root node', () => {
    expect(findNode(sampleForest(), 'item-2')?.id).toBe('item-2');
  });

  it('finds a deeply nested node', () => {
    expect(findNode(sampleForest(), 'g-1')?.id).toBe('g-1');
  });

  it('returns undefined for an absent id', () => {
    expect(findNode(sampleForest(), 'missing')).toBeUndefined();
  });
});

describe('updateNode', () => {
  it('patches a root node scalar field and preserves its children', () => {
    const result = updateNode(sampleForest(), 'item-1', { title: 'Renamed' });
    const updated = findNode(result, 'item-1');
    expect(updated?.title).toBe('Renamed');
    expect(updated?.children).toHaveLength(2);
  });

  it('patches a deeply nested node', () => {
    const result = updateNode(sampleForest(), 'g-1', { notes: 'hello' });
    expect(findNode(result, 'g-1')?.notes).toBe('hello');
  });

  it('can change the id (temp → server reconcile) while keeping children', () => {
    const forest = updateNode(sampleForest(), 'c-1', { id: 'server-c-1' });
    expect(findNode(forest, 'c-1')).toBeUndefined();
    expect(findNode(forest, 'server-c-1')?.children).toHaveLength(1);
  });

  it('is a value no-op when the id is absent (race rule: never re-adds)', () => {
    const before = sampleForest();
    const after = updateNode(before, 'missing', { title: 'X' });
    expect(after).toStrictEqual(before);
  });

  it('does not mutate the input forest', () => {
    const before = sampleForest();
    updateNode(before, 'item-1', { title: 'Renamed' });
    expect(before[0]?.title).toBe('Write tests');
  });
});

describe('removeNode', () => {
  it('removes a root node and reports its index, preserving siblings', () => {
    const result = removeNode(sampleForest(), 'item-1');
    expect(result.removed?.id).toBe('item-1');
    expect(result.parentId).toBeNull();
    expect(result.index).toBe(0);
    expect(result.forest.map((n) => n.id)).toStrictEqual(['item-2']);
  });

  it('removes a nested child, capturing parent id and index', () => {
    const result = removeNode(sampleForest(), 'c-2');
    expect(result.removed?.id).toBe('c-2');
    expect(result.parentId).toBe('item-1');
    expect(result.index).toBe(1);
    expect(findNode(result.forest, 'c-2')).toBeUndefined();
  });

  it('removes a deeply nested grandchild with its (empty) subtree', () => {
    const result = removeNode(sampleForest(), 'g-1');
    expect(result.removed?.id).toBe('g-1');
    expect(result.parentId).toBe('c-1');
    expect(findNode(result.forest, 'g-1')).toBeUndefined();
  });

  it('carries the removed subtree along (the child keeps its descendants)', () => {
    const result = removeNode(sampleForest(), 'c-1');
    expect(getDescendantIds(defined(result.removed))).toStrictEqual(['g-1']);
  });

  it('is a no-op for an absent id', () => {
    const before = sampleForest();
    const result = removeNode(before, 'missing');
    expect(result.removed).toBeUndefined();
    expect(result.index).toBe(-1);
    expect(result.forest).toStrictEqual(before);
  });
});

describe('insertSubtree (rollback inverse of removeNode)', () => {
  it('round-trips a removed nested child back to its exact position', () => {
    const original = sampleForest();
    const { forest, removed, parentId, index } = removeNode(original, 'c-2');
    const restored = insertSubtree(forest, defined(removed), parentId, index);
    expect(restored).toStrictEqual(original);
  });

  it('round-trips a removed root back to its exact position', () => {
    const original = sampleForest();
    const { forest, removed, parentId, index } = removeNode(original, 'item-1');
    const restored = insertSubtree(forest, defined(removed), parentId, index);
    expect(restored.map((n) => n.id)).toStrictEqual(['item-1', 'item-2']);
  });

  it('clamps an out-of-range index', () => {
    const forest = insertSubtree([BASE_NODE], node({ id: 'x' }), null, 99);
    expect(forest.map((n) => n.id)).toStrictEqual(['item-1', 'x']);
  });
});

describe('insertRoot', () => {
  it('inserts newest-first (created_at descending)', () => {
    const forest = [node({ id: 'old', created_at: '2025-01-01T00:00:00Z' })];
    const result = insertRoot(forest, node({ id: 'new', created_at: '2025-06-01T00:00:00Z' }));
    expect(result.map((n) => n.id)).toStrictEqual(['new', 'old']);
  });
});

describe('insertChild', () => {
  it('inserts under the named parent, sorted newest-first', () => {
    const parent = node({
      id: 'p',
      children: [node({ id: 'existing', created_at: '2025-01-01T00:00:00Z' })],
    });
    const result = insertChild(
      [parent],
      'p',
      node({ id: 'fresh', created_at: '2025-06-01T00:00:00Z' }),
    );
    expect(findNode(result, 'p')?.children.map((c) => c.id)).toStrictEqual(['fresh', 'existing']);
  });

  it('falls back to a root insert when the parent is absent', () => {
    const result = insertChild([BASE_NODE], 'no-such-parent', node({ id: 'orphan' }));
    expect(result.map((n) => n.id)).toContain('orphan');
    expect(findNode(result, 'orphan')?.parent_id).toBeNull();
  });
});

describe('makeOptimisticItem', () => {
  it('builds a complete, active node with a temp id', () => {
    const item = makeOptimisticItem({ text: 'Buy milk' });
    expect(isTempId(item.id)).toBe(true);
    expect(item.title).toBe('Buy milk');
    expect(item.raw_capture).toBe('Buy milk');
    expect(item.status).toBe('active');
    expect(item.completed_at).toBeNull();
    expect(item.children).toStrictEqual([]);
  });

  it('prefers an explicit title over text', () => {
    expect(makeOptimisticItem({ title: 'Explicit', text: 'raw' }).title).toBe('Explicit');
  });

  it('carries folder, parent, and due date through', () => {
    const item = makeOptimisticItem({
      text: 't',
      folder_id: 'f-1',
      parent_id: 'p-1',
      due_date: '2026-01-01',
    });
    expect(item.folder_id).toBe('f-1');
    expect(item.parent_id).toBe('p-1');
    expect(item.due_date).toBe('2026-01-01');
  });

  it('generates a unique id each call', () => {
    expect(makeOptimisticItem({ text: 'a' }).id).not.toBe(makeOptimisticItem({ text: 'a' }).id);
  });

  it('produces a node that buildTree leaves as a single root', () => {
    // Sanity: a freshly captured inbox item is a valid standalone tree.
    const item = makeOptimisticItem({ text: 'standalone' });
    expect(buildTree([item])).toHaveLength(1);
  });
});
