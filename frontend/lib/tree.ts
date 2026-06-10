/**
 * Tree-building and tree-editing helpers for the items adjacency list.
 *
 * The API returns a flat Item[] with parent_id linking. `buildTree` converts that
 * flat list into a tree (forest) for recursive rendering. The remaining helpers
 * are pure, immutable forest edits used by the optimistic tasks store
 * (see lib/stores/tasks-store): they apply a predicted change instantly and
 * support reconcile-on-success / rollback-on-error.
 */
import type { CreateItemInput } from '@/lib/api-client';
import type { Item } from '@/lib/types';

export type ItemNode = Item & {
  children: ItemNode[];
};

/**
 * Build a forest (array of root trees) from a flat list of items.
 *
 * Top-level items (parent_id === null) become root nodes. Their children are
 * nested recursively. Items whose parent_id references an id not present in the
 * list are treated as roots (graceful fallback for partial loads).
 */
export function buildTree(items: Item[]): ItemNode[] {
  const nodeMap = new Map<string, ItemNode>();

  // First pass: create all nodes
  for (const item of items) {
    nodeMap.set(item.id, { ...item, children: [] });
  }

  const roots: ItemNode[] = [];

  // Second pass: wire parent → children; collect roots.
  // Avoid ! assertion (no-non-null-assertion) by using a lookup-and-check pattern.
  for (const node of nodeMap.values()) {
    // parent_id is null for Inbox items (top-level), or may reference an id not in the
    // current fetch (e.g. cross-folder subtask edge case). Treat both as roots.
    const parentNode = node.parent_id === null ? undefined : nodeMap.get(node.parent_id);
    if (parentNode === undefined) {
      roots.push(node);
    } else {
      parentNode.children.push(node);
    }
  }

  return sortForest(roots);
}

/** Sort a copy of nodes by created_at descending, then recursively sort children. */
function sortForest(nodes: ItemNode[]): ItemNode[] {
  // unicorn/no-array-sort forbids mutating .sort(); unicorn/no-array-reduce forbids reduce;
  // toSorted() requires ES2023 but tsconfig targets ES2022 — so we use an explicit
  // insertion-sort loop to build a fresh sorted array without any of those APIs.
  const sorted: ItemNode[] = [];
  for (const node of nodes) {
    const insertAt = sorted.findIndex((existing) => existing.created_at < node.created_at);
    if (insertAt === -1) {
      sorted.push(node);
    } else {
      sorted.splice(insertAt, 0, node);
    }
  }
  return sorted.map((node): ItemNode => ({ ...node, children: sortForest(node.children) }));
}

/** Collect all descendant ids (not including the root itself). */
export function getDescendantIds(node: ItemNode): string[] {
  const ids: string[] = [];
  const walk = (n: ItemNode) => {
    for (const child of n.children) {
      ids.push(child.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}

// ---------------------------------------------------------------------------
// Optimistic forest edits (pure, immutable)
//
// These power the optimistic tasks store. Each returns a NEW forest; the input
// is never mutated. Sibling ordering mirrors buildTree's: created_at descending.
// ---------------------------------------------------------------------------

/** Prefix marking a client-generated id that has not yet been reconciled with the server. */
export const TEMP_ID_PREFIX = 'temp-';

/** True if `id` is a client-side optimistic id (not yet reconciled to a server row). */
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

/** Sort a flat list of sibling nodes by created_at descending (does not recurse). */
function sortNodes(nodes: ItemNode[]): ItemNode[] {
  // Insertion sort — matches sortForest; avoids .sort()/toSorted (unicorn + ES2022).
  const sorted: ItemNode[] = [];
  for (const node of nodes) {
    const insertAt = sorted.findIndex((existing) => existing.created_at < node.created_at);
    if (insertAt === -1) {
      sorted.push(node);
    } else {
      sorted.splice(insertAt, 0, node);
    }
  }
  return sorted;
}

/** Find a node anywhere in the forest by id, or undefined if absent. */
export function findNode(forest: ItemNode[], id: string): ItemNode | undefined {
  for (const node of forest) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Patch a node's scalar fields in place (by position), preserving its `children`.
 *
 * `Item` has no `children` key, so a `Partial<Item>` patch can never clobber the
 * locally-accumulated subtree — this is the reconcile invariant: replace scalars
 * from the server row, retain children (so a fast create-parent-then-create-child
 * does not lose the child when the parent reconciles). The patch may change `id`
 * (used to swap a temp id for the server id). A no-op if `id` is not found —
 * which is also the race rule: a reconcile for a node already removed adds nothing.
 */
export function updateNode(forest: ItemNode[], id: string, patch: Partial<Item>): ItemNode[] {
  return forest.map((node) => {
    if (node.id === id) {
      return { ...node, ...patch };
    }
    if (node.children.length > 0) {
      return { ...node, children: updateNode(node.children, id, patch) };
    }
    return node;
  });
}

/** The outcome of removeNode — carries everything insertSubtree needs to roll back. */
export interface RemoveResult {
  /** The forest with the node (and its subtree) removed. */
  forest: ItemNode[];
  /** The removed node with its subtree, or undefined if `id` was not found. */
  removed: ItemNode | undefined;
  /** The removed node's parent id, or null if it was a root. */
  parentId: string | null;
  /** The removed node's index within its sibling list (-1 if not found). */
  index: number;
}

/**
 * Remove a node (and its subtree) from the forest, capturing where it was so the
 * caller can restore it on error via insertSubtree. No-op if `id` is absent.
 */
export function removeNode(forest: ItemNode[], id: string): RemoveResult {
  const search = (nodes: ItemNode[], parentId: string | null): RemoveResult => {
    const index = nodes.findIndex((node) => node.id === id);
    if (index !== -1) {
      const removed = nodes[index];
      if (removed === undefined) {
        return { forest: nodes, removed: undefined, parentId: null, index: -1 };
      }
      return {
        forest: [...nodes.slice(0, index), ...nodes.slice(index + 1)],
        removed,
        parentId,
        index,
      };
    }
    for (const node of nodes) {
      if (node.children.length === 0) continue;
      const result = search(node.children, node.id);
      if (result.removed !== undefined) {
        return {
          forest: nodes.map((n) => (n.id === node.id ? { ...n, children: result.forest } : n)),
          removed: result.removed,
          parentId: result.parentId,
          index: result.index,
        };
      }
    }
    return { forest: nodes, removed: undefined, parentId: null, index: -1 };
  };
  return search(forest, null);
}

/** Splice `node` into `nodes` at a clamped index (position-preserving, no sort). */
function spliceAt(nodes: ItemNode[], node: ItemNode, index: number): ItemNode[] {
  const clamped = Math.max(0, Math.min(index, nodes.length));
  return [...nodes.slice(0, clamped), node, ...nodes.slice(clamped)];
}

/**
 * Restore a previously removed subtree at its original position — the inverse of
 * removeNode, used for rollback. Restores by exact index (not sorted) so the row
 * returns to exactly where it was.
 */
export function insertSubtree(
  forest: ItemNode[],
  removed: ItemNode,
  parentId: string | null,
  index: number,
): ItemNode[] {
  if (parentId === null) {
    return spliceAt(forest, removed, index);
  }
  return forest.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: spliceAt(node.children, removed, index) };
    }
    if (node.children.length > 0) {
      return { ...node, children: insertSubtree(node.children, removed, parentId, index) };
    }
    return node;
  });
}

/** Insert a node at the root level, sorted by created_at descending. */
export function insertRoot(forest: ItemNode[], node: ItemNode): ItemNode[] {
  return sortNodes([...forest, node]);
}

/**
 * Insert a node as a child of `parentId`, sorted by created_at descending. If the
 * parent is not present anywhere in the forest, the node is inserted at the root
 * instead — the same graceful fallback buildTree uses for dangling parent_id edges.
 */
export function insertChild(forest: ItemNode[], parentId: string, node: ItemNode): ItemNode[] {
  if (findNode(forest, parentId) === undefined) {
    return insertRoot(forest, node);
  }
  const attach = (nodes: ItemNode[]): ItemNode[] =>
    nodes.map((current) => {
      if (current.id === parentId) {
        return { ...current, children: sortNodes([...current.children, node]) };
      }
      if (current.children.length > 0) {
        return { ...current, children: attach(current.children) };
      }
      return current;
    });
  return attach(forest);
}

/**
 * Build a complete optimistic ItemNode from a capture input, mirroring the server's
 * POST /api/items defaults (title falls back to text, raw_capture to text, status
 * active). The id is a temp id (see isTempId) until reconciled with the server row.
 */
export function makeOptimisticItem(input: CreateItemInput): ItemNode {
  return {
    id: `${TEMP_ID_PREFIX}${crypto.randomUUID()}`,
    title: input.title ?? input.text ?? '',
    notes: input.notes ?? null,
    source_url: input.source_url ?? null,
    raw_capture: input.raw_capture ?? input.text ?? null,
    item_type: input.item_type ?? 'unclassified',
    due_date: input.due_date ?? null,
    folder_id: input.folder_id ?? null,
    parent_id: input.parent_id ?? null,
    status: 'active',
    completed_at: null,
    created_at: new Date().toISOString(),
    children: [],
  };
}
