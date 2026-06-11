/**
 * Tree helpers for the items adjacency list.
 *
 * Items are stored flat (a single `Item[]` in the tasks store). The API and the store
 * both work with that flat list; these helpers derive the per-view forest for rendering
 * (`buildTree`), walk a subtree (`getDescendantIds` / `collectSubtree`), and mint
 * optimistic placeholders (`makeOptimisticItem`).
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
 * list are treated as roots (graceful fallback for filtered/partial lists — e.g. a
 * completed subtask whose active parent isn't in the completed view).
 */
export function buildTree(items: Item[]): ItemNode[] {
  const nodeMap = new Map<string, ItemNode>();

  // First pass: create all nodes
  for (const item of items) {
    nodeMap.set(item.id, { ...item, children: [] });
  }

  const roots: ItemNode[] = [];

  // Second pass: wire parent → children; collect roots.
  for (const node of nodeMap.values()) {
    // Stryker disable next-line ConditionalExpression: AT_CEILING — id is always a string (never null), so nodeMap.get(parent_id) returns undefined when parent_id is null; the null guard is behavior-equivalent.
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
  // unicorn/no-array-sort forbids mutating .sort(); toSorted() requires ES2023 but
  // tsconfig targets ES2022 — so we use an explicit insertion-sort loop.
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

/**
 * Walk the ancestor chain from a starting `parentId` up a FLAT list, returning the
 * ancestor titles ordered oldest → youngest (root first, immediate parent last).
 * Pass the node's own `parent_id` as the start — the node itself need not be in the
 * list, only its ancestors (which may be active items filtered out of a view, e.g.
 * the completed view's breadcrumb). Returns [] for a null start or an absent chain,
 * and halts on a cycle (a `seen` set guards against an infinite loop).
 */
export function getAncestorTitles(items: Item[], parentId: string | null): string[] {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const titles: string[] = [];
  const seen = new Set<string>();
  let currentId = parentId;
  // Stryker disable next-line ConditionalExpression: AT_CEILING — when currentId is null, byId.get(null) is undefined → break; entering the loop changes nothing observable.
  while (currentId !== null && !seen.has(currentId)) {
    seen.add(currentId);
    const parent = byId.get(currentId);
    if (parent === undefined) break;
    // Walk youngest → oldest but prepend, so the result is oldest-first with no reverse().
    titles.unshift(parent.title);
    currentId = parent.parent_id;
  }
  return titles;
}

/** Collect all descendant ids of a built node (not including the node itself). */
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

/**
 * From a FLAT list, collect the item with `rootId` plus all its descendants (the items
 * themselves). Used by the store for cascade operations (complete/move/delete a subtree)
 * and to capture the affected rows for rollback. Returns [] if `rootId` is absent.
 */
export function collectSubtree(items: Item[], rootId: string): Item[] {
  const childrenByParent = new Map<string, Item[]>();
  for (const item of items) {
    // Stryker disable next-line ConditionalExpression: AT_CEILING — root items would bucket under key null, which is never read (no item id is null); the collected subtree is unchanged.
    if (item.parent_id !== null) {
      const siblings = childrenByParent.get(item.parent_id) ?? [];
      siblings.push(item);
      childrenByParent.set(item.parent_id, siblings);
    }
  }

  const root = items.find((item) => item.id === rootId);
  // Stryker disable next-line ConditionalExpression: AT_CEILING — without this early return, an undefined root is caught by the stack guard below and still yields []; identical result.
  if (root === undefined) return [];

  const result: Item[] = [];
  const stack: Item[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    // Stryker disable next-line ConditionalExpression: AT_CEILING — the stack only ever holds defined Items, so pop() is never undefined; this guard is dead defensive code.
    if (current === undefined) continue;
    result.push(current);
    for (const child of childrenByParent.get(current.id) ?? []) {
      stack.push(child);
    }
  }
  return result;
}

/** Prefix marking a client-generated id that has not yet been reconciled with the server. */
export const TEMP_ID_PREFIX = 'temp-';

/** True if `id` is a client-side optimistic id (not yet reconciled to a server row). */
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

/**
 * Build a complete optimistic Item from a capture input, mirroring the server's
 * POST /api/items defaults (title falls back to text, raw_capture to text, status
 * active). The id is a temp id (see isTempId) until reconciled with the server row.
 */
export function makeOptimisticItem(input: CreateItemInput): Item {
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
  };
}
