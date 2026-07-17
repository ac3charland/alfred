import {
  REORDER_GAP_PREFIX,
  computeInsertOrder,
  isReorderGap,
  parseReorderGapId,
  reorderGapId,
  resolveReorder,
} from './reorder-subtask';

describe('reorderGapId / parseReorderGapId / isReorderGap', () => {
  it('round-trips a parent id and index', () => {
    const id = reorderGapId('parent-1', 3);
    expect(id.startsWith(REORDER_GAP_PREFIX)).toBe(true);
    expect(parseReorderGapId(id)).toStrictEqual({ parentId: 'parent-1', index: 3 });
  });

  it('round-trips a parent id that itself contains a colon-like uuid', () => {
    // Parses on the LAST separator, so a parent id is recovered intact.
    const id = reorderGapId('a1b2::c3', 0);
    expect(parseReorderGapId(id)).toStrictEqual({ parentId: 'a1b2::c3', index: 0 });
  });

  it('recognises gap ids and rejects everything else', () => {
    expect(isReorderGap(reorderGapId('p', 0))).toBe(true);
    expect(isReorderGap('some-row-id')).toBe(false);
    expect(isReorderGap(null)).toBe(false);
    expect(parseReorderGapId('some-row-id')).toBeNull();
    expect(parseReorderGapId(null)).toBeNull();
  });
});

describe('computeInsertOrder', () => {
  it('returns 0 for an empty group (both neighbours null)', () => {
    expect(computeInsertOrder(null, null)).toBe(0);
  });

  it('returns one below the first row for the top gap', () => {
    expect(computeInsertOrder(null, 10)).toBe(9);
  });

  it('returns one above the last row for the bottom gap', () => {
    expect(computeInsertOrder(10, null)).toBe(11);
  });

  it('returns the midpoint between two neighbours', () => {
    expect(computeInsertOrder(10, 20)).toBe(15);
    expect(computeInsertOrder(10, 11)).toBe(10.5);
  });
});

const subtree = (ids: string[]): ReadonlySet<string> => new Set(ids);

describe('resolveReorder', () => {
  it('places a subtask between two siblings in the same parent (midpoint)', () => {
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 5, // currently the first child
      gapParentId: 'p',
      orderedSiblings: [
        { id: 'a', sortOrder: 10 },
        { id: 'b', sortOrder: 20 },
      ],
      insertIndex: 1, // between a and b
      subtreeIds: subtree(['d']),
    });
    expect(result).toStrictEqual({ itemId: 'd', parentId: 'p', sortOrder: 15 });
  });

  it('is a no-op when dropped back into its own current slot (same parent)', () => {
    // dragged sort_order 15 sits between a(10) and b(20): its current index (excluding itself) is
    // 1, so inserting at gap 1 changes nothing.
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 15,
      gapParentId: 'p',
      orderedSiblings: [
        { id: 'a', sortOrder: 10 },
        { id: 'b', sortOrder: 20 },
      ],
      insertIndex: 1,
      subtreeIds: subtree(['d']),
    });
    expect(result).toBeNull();
  });

  it('moves within the same parent to a different slot (to the top)', () => {
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 15,
      gapParentId: 'p',
      orderedSiblings: [
        { id: 'a', sortOrder: 10 },
        { id: 'b', sortOrder: 20 },
      ],
      insertIndex: 0, // above a → one below a's rank
      subtreeIds: subtree(['d']),
    });
    expect(result).toStrictEqual({ itemId: 'd', parentId: 'p', sortOrder: 9 });
  });

  it('re-parents into a different parent at the given slot (bottom gap)', () => {
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 5,
      gapParentId: 'other',
      orderedSiblings: [
        { id: 'x', sortOrder: 100 },
        { id: 'y', sortOrder: 200 },
      ],
      insertIndex: 2, // below y
      subtreeIds: subtree(['d']),
    });
    expect(result).toStrictEqual({ itemId: 'd', parentId: 'other', sortOrder: 201 });
  });

  it('rejects a cross-parent drop into the dragged row’s own subtree (cycle)', () => {
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 5,
      gapParentId: 'grandchild', // a descendant of d
      orderedSiblings: [],
      insertIndex: 0,
      subtreeIds: subtree(['d', 'child', 'grandchild']),
    });
    expect(result).toBeNull();
  });

  it('places into an empty target group at sort_order 0', () => {
    const result = resolveReorder({
      draggedId: 'd',
      draggedParentId: 'p',
      draggedSortOrder: 5,
      gapParentId: 'empty',
      orderedSiblings: [],
      insertIndex: 0,
      subtreeIds: subtree(['d']),
    });
    expect(result).toStrictEqual({ itemId: 'd', parentId: 'empty', sortOrder: 0 });
  });
});
