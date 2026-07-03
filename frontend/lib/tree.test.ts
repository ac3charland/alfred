import type { Item } from '@/lib/types';

import {
  TEMP_ID_PREFIX,
  buildTree,
  collectSubtree,
  countCompletedDescendants,
  getAncestorTitles,
  getDescendantIds,
  getItemDepth,
  hasActiveDescendant,
  isTempId,
  makeOptimisticEpic,
  makeOptimisticFolder,
  makeOptimisticItem,
  makeOptimisticProject,
  makeOptimisticStory,
  tempId,
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
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
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
    // Roots are newest-first: item-1 (01-05) before item-2 (01-01).
    expect(forest.map((n) => n.id)).toStrictEqual(['item-1', 'item-2']);
    const root = forest[0];
    // Subtasks render oldest-first (chronological): c-2 (01-02) before c-1 (01-03).
    expect(root?.children.map((c) => c.id)).toStrictEqual(['c-2', 'c-1']);
    const childWithGrandchild = root?.children.find((c) => c.id === 'c-1');
    expect(childWithGrandchild?.children.map((g) => g.id)).toStrictEqual(['g-1']);
  });

  it('sorts root siblings by created_at descending (newest first)', () => {
    const forest = buildTree([
      item({ id: 'old', created_at: '2025-01-01T00:00:00Z' }),
      item({ id: 'new', created_at: '2025-06-01T00:00:00Z' }),
    ]);
    expect(forest.map((n) => n.id)).toStrictEqual(['new', 'old']);
  });

  it('sorts subtask siblings by created_at ascending (chronological)', () => {
    // A single parent with two subtasks captured out of order — the children sort
    // oldest-first regardless of input order (ALF-43).
    const forest = buildTree([
      item({ id: 'parent', created_at: '2025-01-10T00:00:00Z' }),
      item({ id: 'newer-child', parent_id: 'parent', created_at: '2025-06-01T00:00:00Z' }),
      item({ id: 'older-child', parent_id: 'parent', created_at: '2025-01-01T00:00:00Z' }),
    ]);
    expect(forest[0]?.children.map((c) => c.id)).toStrictEqual(['older-child', 'newer-child']);
  });

  it('keeps stable order when two root items share the same created_at', () => {
    // Both share the same timestamp — neither should displace the other.
    // With `<` (correct, descending roots), equal timestamps do NOT trigger an
    // insertion, so the second item appended stays last. With `<=` (mutant), the
    // second equal item would be inserted before the first, changing order.
    const forest = buildTree([
      item({ id: 'first', created_at: '2025-03-01T00:00:00Z' }),
      item({ id: 'second', created_at: '2025-03-01T00:00:00Z' }),
    ]);
    // 'first' was inserted before 'second'; they share the same timestamp so no
    // reordering should occur — 'first' remains before 'second'.
    expect(forest.map((n) => n.id)).toStrictEqual(['first', 'second']);
  });

  it('keeps stable order when two subtasks share the same created_at', () => {
    // The ascending child path uses a `>` (strict) comparison, so equal-timestamp
    // siblings keep insertion order; a `>=` mutant would swap them.
    const forest = buildTree([
      item({ id: 'parent', created_at: '2025-01-10T00:00:00Z' }),
      item({ id: 'child-a', parent_id: 'parent', created_at: '2025-03-01T00:00:00Z' }),
      item({ id: 'child-b', parent_id: 'parent', created_at: '2025-03-01T00:00:00Z' }),
    ]);
    expect(forest[0]?.children.map((c) => c.id)).toStrictEqual(['child-a', 'child-b']);
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

describe('hasActiveDescendant', () => {
  it('is true when a descendant is still active at any depth', () => {
    // item-1 (completed) → c-1 (completed) → g-1 (active). The lone active node is a grandchild.
    const root = defined(
      buildTree([
        item({ id: 'item-1', status: 'completed', created_at: '2025-01-05T00:00:00Z' }),
        item({ id: 'c-1', parent_id: 'item-1', status: 'completed' }),
        item({ id: 'g-1', parent_id: 'c-1', status: 'active' }),
      ])[0],
    );
    expect(hasActiveDescendant(root)).toBe(true);
  });

  it('is false when every descendant is completed (the node itself is ignored)', () => {
    // item-1 (active) → c-1 (completed) → g-1 (completed). Only descendants count.
    const root = defined(
      buildTree([
        item({ id: 'item-1', status: 'active', created_at: '2025-01-05T00:00:00Z' }),
        item({ id: 'c-1', parent_id: 'item-1', status: 'completed' }),
        item({ id: 'g-1', parent_id: 'c-1', status: 'completed' }),
      ])[0],
    );
    expect(hasActiveDescendant(root)).toBe(false);
  });

  it('is false for a leaf', () => {
    expect(hasActiveDescendant(defined(buildTree([BASE])[0]))).toBe(false);
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

describe('getItemDepth', () => {
  it('returns 0 for a root item', () => {
    expect(getItemDepth(flatItems(), 'item-1')).toBe(0);
  });

  it('returns 1 for a direct child', () => {
    expect(getItemDepth(flatItems(), 'c-1')).toBe(1);
  });

  it('returns 2 for a grandchild', () => {
    expect(getItemDepth(flatItems(), 'g-1')).toBe(2);
  });

  it('returns 0 for an unknown id', () => {
    expect(getItemDepth(flatItems(), 'nonexistent')).toBe(0);
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

describe('tempId', () => {
  it('mints a temp-prefixed id recognised by isTempId', () => {
    expect(isTempId(tempId())).toBe(true);
  });

  it('generates a unique id each call', () => {
    expect(tempId()).not.toBe(tempId());
  });
});

describe('makeOptimisticFolder', () => {
  it('builds a folder with the given name and a temp id', () => {
    const folder = makeOptimisticFolder('Projects');
    expect(folder.name).toBe('Projects');
    expect(isTempId(folder.id)).toBe(true);
    expect(typeof folder.created_at).toBe('string');
  });
});

describe('makeOptimisticProject', () => {
  it('carries name/key/github_url through with placeholder repo fields and a temp id', () => {
    const project = makeOptimisticProject({
      name: 'Alfred',
      key: 'ALF',
      github_url: 'https://github.com/ac3charland/alfred',
    });
    expect(isTempId(project.id)).toBe(true);
    expect(project.name).toBe('Alfred');
    expect(project.key).toBe('ALF');
    expect(project.github_url).toBe('https://github.com/ac3charland/alfred');
    // repo_owner/repo_name are derived server-side; placeholders until reconcile.
    expect(project.repo_owner).toBe('');
    expect(project.repo_name).toBe('');
    expect(project.ref_seq).toBe(0);
  });
});

describe('makeOptimisticEpic', () => {
  it('builds an epic under the given project with a temp id and empty ref', () => {
    const epic = makeOptimisticEpic('p-1', 'Onboarding');
    expect(isTempId(epic.id)).toBe(true);
    expect(epic.project_id).toBe('p-1');
    expect(epic.name).toBe('Onboarding');
    expect(epic.notes).toBeNull();
    // The real ref/ref_number arrive from create_epic.
    expect(epic.ref).toBe('');
    expect(epic.ref_number).toBe(0);
    expect(epic.archived_at).toBeNull();
  });
});

describe('makeOptimisticStory', () => {
  const PROJECT = {
    id: 'p-1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 5,
    created_at: '2025-01-01T00:00:00Z',
  };
  const EPIC = {
    id: 'e-1',
    project_id: 'p-1',
    name: 'Onboarding',
    notes: null,
    ref_number: 1,
    ref: 'ALF-1',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
  };

  it('joins the item with its project + epic into a board-shaped story with a placeholder ref', () => {
    const story = makeOptimisticStory(
      { id: 'item-1', title: 'Build the thing', notes: 'a note', source_url: null },
      PROJECT,
      EPIC,
    );
    expect(story.item_id).toBe('item-1');
    expect(story.project_id).toBe('p-1');
    expect(story.epic_id).toBe('e-1');
    expect(story.title).toBe('Build the thing');
    expect(story.notes).toBe('a note');
    expect(story.factory_state).toBe('needs_refinement');
    expect(story.lane).toBe('human');
    // The real ref/ref_number arrive from enter_code_module.
    expect(story.ref).toBe('');
    expect(story.ref_number).toBe(0);
    // Joined project/epic fields the card renders immediately.
    expect(story.project_key).toBe('ALF');
    expect(story.epic_name).toBe('Onboarding');
    expect(story.epic_ref).toBe('ALF-1');
  });
});
