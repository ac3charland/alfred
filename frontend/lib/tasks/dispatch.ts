import { isTempId } from '@/lib/tree';
import type { Item } from '@/lib/types';

/**
 * Dispatch **readiness** — the one place the rule lives (the residency twin of
 * `lib/tasks/residency.ts`).
 *
 * Dispatch sends each selected Inbox item to the destination its labels already name: a task to
 * its folder, a code item through the factory gate. An item is *ready* when those labels are
 * complete; an unready item is never sent and never a failure — it just isn't ready yet, and the
 * blocker says what it's missing. Pure, so every row of the readiness table is a unit test and
 * nothing about readiness lives inside a component.
 */

/** Why an item can't be dispatched yet, in the bulk bar's own words. */
export type DispatchBlocker =
  | 'needs a type'
  | 'needs a folder'
  | 'needs a project'
  | 'needs an epic'
  | 'convert from its own row menu'
  | 'still saving';

export type DispatchReadiness = { ready: true } | { ready: false; blocker: DispatchBlocker };

/** The item fields readiness reads — satisfied by both a flat `Item` and an `ItemNode`. */
export type DispatchCandidate = Pick<
  Item,
  'id' | 'item_type' | 'folder_id' | 'intended_project_id' | 'intended_epic_id'
>;

/**
 * Whether one selected root can be dispatched, and what it's missing when it can't.
 *
 * - A **task** is ready once it carries a folder (its subtree travels with it).
 * - A **code** item is ready once it carries both hints — and has no children, because an
 *   epic-shaped row converts through `convert_to_code_epic`, not `enter_code_module`, so its
 *   path stays the row menu's.
 * - An **unclassified** row is never ready, and a row still carrying a temp id can't be
 *   PATCHed or passed to an RPC at all.
 */
export function dispatchReadiness(
  item: DispatchCandidate,
  hasChildren: boolean,
): DispatchReadiness {
  if (isTempId(item.id)) return { ready: false, blocker: 'still saving' };
  if (item.item_type === 'task') {
    return item.folder_id === null ? { ready: false, blocker: 'needs a folder' } : { ready: true };
  }
  if (item.item_type === 'code') {
    if (hasChildren) return { ready: false, blocker: 'convert from its own row menu' };
    if (item.intended_project_id === null) return { ready: false, blocker: 'needs a project' };
    if (item.intended_epic_id === null) return { ready: false, blocker: 'needs an epic' };
    return { ready: true };
  }
  return { ready: false, blocker: 'needs a type' };
}

/** Singular / plural phrasing per blocker, so a grouped count reads as a sentence. */
const BLOCKER_PHRASES: Record<DispatchBlocker, { one: string; many: string }> = {
  'needs a type': { one: 'needs a type', many: 'need a type' },
  'needs a folder': { one: 'needs a folder', many: 'need a folder' },
  'needs a project': { one: 'needs a project', many: 'need a project' },
  'needs an epic': { one: 'needs an epic', many: 'need an epic' },
  'convert from its own row menu': {
    one: 'convert from its own row menu',
    many: 'convert from their own row menus',
  },
  'still saving': { one: 'still saving', many: 'still saving' },
};

/** The canonical group order — type first (the broadest gap), then the label gaps, then state. */
const BLOCKER_ORDER: DispatchBlocker[] = [
  'needs a type',
  'needs a folder',
  'needs a project',
  'needs an epic',
  'convert from its own row menu',
  'still saving',
];

/**
 * The bulk bar's readiness line: what the selection is missing, grouped by reason with counts —
 * `2 not ready — 1 needs a folder, 1 needs an epic`. `null` when every blocker list is empty
 * (the whole selection is ready), so the caller renders nothing.
 */
export function summarizeBlockers(blockers: DispatchBlocker[]): string | null {
  if (blockers.length === 0) return null;
  const counts = new Map<DispatchBlocker, number>();
  for (const blocker of blockers) counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
  const parts = BLOCKER_ORDER.filter((blocker) => counts.has(blocker)).map((blocker) => {
    const count = counts.get(blocker) ?? 0;
    const phrase = BLOCKER_PHRASES[blocker];
    return `${String(count)} ${count === 1 ? phrase.one : phrase.many}`;
  });
  return `${String(blockers.length)} not ready — ${parts.join(', ')}`;
}
