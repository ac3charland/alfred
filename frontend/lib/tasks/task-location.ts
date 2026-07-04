import type { Item } from '@/lib/types';

/**
 * Pure domain logic for *where a task lives* — the view that actually renders it. Kept free of
 * React and the DOM so the routing rules are exhaustively unit-testable on their own, and shared
 * by every "jump to this task" affordance (global search, the By-Priority list, …).
 */

/**
 * Resolve a task's top-level ancestor, so a subtask routes to the view that actually shows it.
 * Guards against a broken parent chain (a missing or cyclic `parent_id`) by bailing on a repeat.
 */
export function resolveRoot(item: Item, byId: Map<string, Item>): Item {
  let root = item;
  const seen = new Set<string>();
  while (root.parent_id !== null && !seen.has(root.id)) {
    seen.add(root.id);
    const parent = byId.get(root.parent_id);
    if (parent === undefined) break;
    root = parent;
  }
  return root;
}

/**
 * The client-side destination for a task: its containing view, derived from the top-level
 * ancestor's own fields. Completed → the Completed view; in a folder → that folder; otherwise
 * the Inbox (revealed via `?view=inbox`).
 */
export function taskDestination(item: Item, tasks: readonly Item[]): string {
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const root = resolveRoot(item, byId);
  if (root.status === 'completed') return '/completed';
  if (root.folder_id !== null) return `/folders/${root.folder_id}`;
  return '/?view=inbox';
}
