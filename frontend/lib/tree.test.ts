import type { Item } from '@/lib/types';

import {
  TEMP_ID_PREFIX,
  buildTree,
  collectSubtree,
  countCompletedDescendants,
  getAncestorTitles,
  getDescendantIds,
  isTempId,
  makeOptimisticItem,
} from './tree';

/** Narrow `T | undefined` to `T` without a cast or non-null assertion (both linted out). */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a defined value');
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: Item = {
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
};

function item(overrides: Partial<Item>): Item {
  return { ...BASE, ...overrides };
}

/** A flat list: two roots; root-1 has two children, the first with a grandchild. */
function flatItems(): Item[] {
  return [
    item({ id: 'item-1', created_at: '2025-01-05T00:00:00Z' }),
    item({ id: 'c-1', parent_id: 'item-1', created_at: '2025-01-03T00:00:00Z' }),
    item({ id: 'c-2', parent_id: 'item-1', created_at: '2025-01-02T00:00:00Z' }),
    item({ id: 'g-1', parent_id: 'c-1', created_at: '2025-01-04T00:00:00Z' }),
    item({ id: 'item-2', created_at: '2025-01-01T00:00:00Z' }),
  ];
}

describe('buildTree', () => {
  it('nests children under parents by parent_id', () => {
    const forest = buildTree(flatItems());
    expect(forest.map((n) => n.id)).toStrictEqual(['item-1', 'item-2']);
    const root = forest[0];
    expect(root?.children.map((c) => c.id)).toStrictEqual(['c-1', 'c-2']);
    expect(root?.children[0]?.children.map((g) => g.id)).toStrictEqual(['g-1']);
  });

  it('sorts siblings by created_at descending', () => {
    const forest = buildTree([
      item({ id: 'old', created_at: '2025-01-01T00:00:00Z' }),
      item({ id: 'new', created_at: '2025-06-01T00:00:00Z' }),
    ]);
    expect(forest.map((n) => n.id)).toStrictEqual(['new', 'old']);
  });

  it('keeps stable order when two items share the same created_at', () => {
    // Both share the same timestamp — neither should displace the other.
    // With `<` (correct), equal timestamps do NOT trigger an insertion, so the
    // second item appended stays last. With `<=` (mutant), the second equal item
    // would be inserted before the first, changing order.
    const forest = buildTree([
      item({ id: 'first', created_at: '2025-03-01T00:00:00Z' }),
      item({ id: 'second', created_at: '2025-03-01T00:00:00Z' }),
    ]);
    // 'first' was inserted before 'second'; they share the same timestamp so no
    // reordering should occur — 'first' remains before 'second'.
    expect(forest.map((n) => n.id)).toStrictEqual(['first', 'second']);
  });

  it('treats an item whose parent is absent as a root (filtered-view fallback)', () => {
    // A completed child whose active parent is not in the filtered list.
    const forest = buildTree([item({ id: 'orphan', parent_id: 'not-here' })]);
    expect(forest.map((n) => n.id)).toStrictEqual(['orphan']);
  });
});

describe('getDescendantIds', () => {
  it('collects all descendants of a built node', () => {
    const root = defined(buildTree(flatItems())[0]);
    expect(new Set(getDescendantIds(root))).toStrictEqual(new Set(['c-1', 'c-2', 'g-1']));
  });

  it('returns an empty array for a leaf', () => {
    expect(getDescendantIds(defined(buildTree([BASE])[0]))).toStrictEqual([]);
  });
});

describe('countCompletedDescendants', () => {
  it('counts completed descendants at every depth, ignoring the node itself', () => {
    // item-1 (active) → c-1 (completed) → g-1 (completed); c-2 (active). Two completed.
    const root = defined(
      buildTree([
        item({ id: 'item-1', status: 'completed', created_at: '2025-01-05T00:00:00Z' }),
        item({ id: 'c-1', parent_id: 'item-1', status: 'completed' }),
        item({ id: 'c-2', parent_id: 'item-1', status: 'active' }),
        item({ id: 'g-1', parent_id: 'c-1', status: 'completed' }),
      ])[0],
    );
    // The root's own completed status is NOT counted — only its descendants.
    expect(countCompletedDescendants(root)).toBe(2);
  });

  it('returns 0 when no descendant is completed', () => {
    const root = defined(buildTree(flatItems())[0]);
    expect(countCompletedDescendants(root)).toBe(0);
  });

  it('returns 0 for a leaf', () => {
    expect(countCompletedDescendants(defined(buildTree([BASE])[0]))).toBe(0);
  });
});

describe('collectSubtree', () => {
  it('returns the root plus all descendants from a flat list', () => {
    const ids = new Set(collectSubtree(flatItems(), 'item-1').map((it) => it.id));
    expect(ids).toStrictEqual(new Set(['c-1', 'c-2', 'g-1', 'item-1']));
  });

  it('returns just the item for a leaf', () => {
    expect(collectSubtree(flatItems(), 'item-2').map((it) => it.id)).toStrictEqual(['item-2']);
  });

  it('returns an empty list for an absent id', () => {
    expect(collectSubtree(flatItems(), 'missing')).toStrictEqual([]);
  });
});

// A → B → C chain (A is the root/oldest, C the deepest), plus an unrelated root.
function ancestorChain(): Item[] {
  return [
    item({ id: 'a', title: 'A', parent_id: null }),
    item({ id: 'b', title: 'B', parent_id: 'a' }),
    item({ id: 'c', title: 'C', parent_id: 'b' }),
    item({ id: 'other', title: 'Other', parent_id: null }),
  ];
}

describe('getAncestorTitles', () => {
  it('lists ancestor titles oldest → youngest from a starting parent_id', () => {
    // Starting from C's parent (b): walk b → a, returned root-first.
    expect(getAncestorTitles(ancestorChain(), 'b')).toStrictEqual(['A', 'B']);
  });

  it('returns an empty array for a null parent_id (top-level item)', () => {
    expect(getAncestorTitles(ancestorChain(), null)).toStrictEqual([]);
  });

  it('stops gracefully when an ancestor is absent from the list', () => {
    expect(
      getAncestorTitles([item({ id: 'b', title: 'B', parent_id: 'gone' })], 'b'),
    ).toStrictEqual(['B']);
  });

  it('does not loop forever on a cyclic parent_id', () => {
    const cyclic = [
      item({ id: 'x', title: 'X', parent_id: 'y' }),
      item({ id: 'y', title: 'Y', parent_id: 'x' }),
    ];
    // Walks x → y, then y → x is already seen, so it halts.
    expect(getAncestorTitles(cyclic, 'x')).toStrictEqual(['Y', 'X']);
  });
});

describe('isTempId', () => {
  it('recognises optimistic ids by prefix', () => {
    expect(isTempId(`${TEMP_ID_PREFIX}abc`)).toBe(true);
    expect(isTempId('item-1')).toBe(false);
  });
});

describe('makeOptimisticItem', () => {
  it('builds a complete, active, flat item with a temp id', () => {
    const it = makeOptimisticItem({ text: 'Buy milk' });
    expect(isTempId(it.id)).toBe(true);
    expect(it.title).toBe('Buy milk');
    expect(it.raw_capture).toBe('Buy milk');
    expect(it.status).toBe('active');
    expect(it.completed_at).toBeNull();
    // Flat Item — no children key.
    expect('children' in it).toBe(false);
  });

  it('prefers an explicit title over text', () => {
    expect(makeOptimisticItem({ title: 'Explicit', text: 'raw' }).title).toBe('Explicit');
  });

  it('carries folder, parent, and due date through', () => {
    const it = makeOptimisticItem({
      text: 't',
      folder_id: 'f-1',
      parent_id: 'p-1',
      due_date: '2026-01-01',
    });
    expect(it.folder_id).toBe('f-1');
    expect(it.parent_id).toBe('p-1');
    expect(it.due_date).toBe('2026-01-01');
  });

  it('preserves notes and source_url when provided', () => {
    const it = makeOptimisticItem({
      text: 't',
      notes: 'my note',
      source_url: 'https://example.com',
    });
    // These use `?? null` — if mutated to `&& null`, truthy inputs would be lost.
    expect(it.notes).toBe('my note');
    expect(it.source_url).toBe('https://example.com');
  });

  it('defaults notes and source_url to null when omitted', () => {
    const it = makeOptimisticItem({ text: 't' });
    expect(it.notes).toBeNull();
    expect(it.source_url).toBeNull();
  });

  it('carries an explicit item_type through', () => {
    // item_type uses `?? 'unclassified'` — if mutated to `&& 'unclassified'`, a
    // truthy input would be replaced with 'unclassified'; if the default string
    // literal is mutated to '', an absent type would yield '' instead.
    expect(makeOptimisticItem({ text: 't', item_type: 'task' }).item_type).toBe('task');
  });

  it('defaults item_type to "unclassified" when omitted', () => {
    expect(makeOptimisticItem({ text: 't' }).item_type).toBe('unclassified');
  });

  it('defaults title and raw_capture to empty string when neither title nor text is provided', () => {
    // Covers the `?? ''` fallback at the end of the title/raw_capture chain.
    const it = makeOptimisticItem({});
    expect(it.title).toBe('');
    expect(it.raw_capture).toBeNull();
  });

  it('generates a unique id each call', () => {
    expect(makeOptimisticItem({ text: 'a' }).id).not.toBe(makeOptimisticItem({ text: 'a' }).id);
  });
});
