/**
 * Tree helpers for the items adjacency list.
 *
 * Items are stored flat (a single `Item[]` in the tasks store). The API and the store
 * both work with that flat list; these helpers derive the per-view forest for rendering
 * (`buildTree`), walk a subtree (`getDescendantIds` / `collectSubtree`), and mint
 * optimistic placeholders (`makeOptimisticItem` and the per-entity optimistic-row builders
 * for folders / projects / epics / code stories).
 */
import type { CreateItemInput, CreateProjectInput } from '@/lib/api-client';
import type { CodeStory, Epic, Folder, Item, Project } from '@/lib/types';

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

  // Roots are newest-first (the capture-first inbox); subtasks read chronologically.
  return sortForest(roots, false);
}

/**
 * Sort a copy of `nodes` by created_at, then recursively sort their children.
 *
 * Roots sort **descending** (newest first — the capture-first list shows the latest
 * thing you captured at the top). Subtasks sort **ascending** (chronological, oldest
 * first) at every depth, so a decomposed task reads top-to-bottom in the order its
 * steps were added (ALF-43) — hence children always recurse with `ascending = true`.
 */
function sortForest(nodes: ItemNode[], ascending: boolean): ItemNode[] {
  // unicorn/no-array-sort forbids mutating .sort(); toSorted() requires ES2023 but
  // tsconfig targets ES2022 — so we use an explicit insertion-sort loop. The strict
  // comparison keeps the sort stable: equal timestamps never displace an earlier sibling.
  const sorted: ItemNode[] = [];
  for (const node of nodes) {
    const insertAt = sorted.findIndex((existing) =>
      ascending ? existing.created_at > node.created_at : existing.created_at < node.created_at,
    );
    if (insertAt === -1) {
      sorted.push(node);
    } else {
      sorted.splice(insertAt, 0, node);
    }
  }
  return sorted.map((node): ItemNode => ({ ...node, children: sortForest(node.children, true) }));
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

/** Walk the ancestor chain to find how many levels deep `itemId` is (root = 0). */
export function getItemDepth(items: Item[], itemId: string): number {
  let depth = 0;
  let currentId: string | null = itemId;
  while (currentId !== null) {
    const current = items.find((t) => t.id === currentId);
    if (current === undefined) break;
    currentId = current.parent_id;
    if (currentId !== null) depth++;
  }
  return depth;
}

/** Count all descendants (any depth) whose status is `completed` (excludes the node itself). */
export function countCompletedDescendants(node: ItemNode): number {
  let count = 0;
  for (const child of node.children) {
    if (child.status === 'completed') count += 1;
    count += countCompletedDescendants(child);
  }
  return count;
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

/** Mint a fresh client-side temp id (see isTempId) for an optimistic row. */
export function tempId(): string {
  return `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
}

/** Build an optimistic folder row (a temp id until the server row reconciles). */
export function makeOptimisticFolder(name: string): Folder {
  return {
    id: tempId(),
    name,
    created_at: new Date().toISOString(),
  };
}

/** Build an optimistic project row (a temp id until the server row reconciles). */
export function makeOptimisticProject(input: CreateProjectInput): Project {
  return {
    id: tempId(),
    name: input.name,
    key: input.key,
    // repo_owner/repo_name are derived server-side; show placeholders until reconcile.
    repo_owner: '',
    repo_name: '',
    github_url: input.github_url,
    ref_seq: 0,
    created_at: new Date().toISOString(),
  };
}

/** Build an optimistic epic row. The real ref/ref_number arrive from `create_epic`. */
export function makeOptimisticEpic(projectId: string, name: string): Epic {
  return {
    id: tempId(),
    project_id: projectId,
    name,
    notes: null,
    ref_number: 0,
    ref: '',
    archived_at: null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Build the optimistic flattened `CodeStory` (the board read shape) for an item entering
 * the factory, joining the known project + epic so the card renders immediately. The real
 * ref/ref_number arrive from `enter_code_module`.
 */
export function makeOptimisticStory(
  item: { id: string; title: string; notes: string | null; source_url: string | null },
  project: Project,
  epic: Epic,
): CodeStory {
  const now = new Date().toISOString();
  return {
    item_id: item.id,
    project_id: project.id,
    epic_id: epic.id,
    ref_number: 0,
    ref: '',
    factory_state: 'needs_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: now,
    code_updated_at: now,
    title: item.title,
    notes: item.notes,
    source_url: item.source_url,
    item_created_at: now,
    project_key: project.key,
    project_name: project.name,
    repo_owner: project.repo_owner,
    repo_name: project.repo_name,
    epic_name: epic.name,
    epic_ref: epic.ref,
    epic_archived_at: epic.archived_at,
    priority: 0,
  };
}
