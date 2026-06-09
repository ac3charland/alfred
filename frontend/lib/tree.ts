/**
 * Tree-building helpers for the items adjacency list.
 *
 * The API returns a flat Item[] with parent_id linking. These helpers convert
 * that flat list into a tree (forest) for recursive rendering in the UI.
 */
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
