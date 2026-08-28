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
  | 'dispatch from its own row menu'
  | 'still saving';

export type DispatchReadiness = { ready: true } | { ready: false; blocker: DispatchBlocker };

/** The item fields readiness reads — satisfied by both a flat `Item` and an `ItemNode`. */
export type DispatchCandidate = Pick<
  Item,
  'id' | 'item_type' | 'folder_id' | 'intended_project_id' | 'intended_epic_id'
>;

/**
 * Whether one selected root can be dispatched **from the bulk bar**, and what it's missing when
 * it can't.
 *
 * - A **task** is ready once it carries a folder (its subtree travels with it).
 * - A **code** item is ready once it carries both hints — and has no children, because an
 *   epic-shaped row converts through `convert_to_code_epic`, not `enter_code_module`, so its
 *   path stays the row menu's (see {@link rowDispatchAction}).
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
    if (hasChildren) return { ready: false, blocker: 'dispatch from its own row menu' };
    if (item.intended_project_id === null) return { ready: false, blocker: 'needs a project' };
    if (item.intended_epic_id === null) return { ready: false, blocker: 'needs an epic' };
    return { ready: true };
  }
  return { ready: false, blocker: 'needs a type' };
}

/**
 * What a row's ⋯-menu **Dispatch** would do — the row's twin of {@link dispatchReadiness}, and
 * the only place the two surfaces differ.
 *
 * - `send` — the ordinary dispatch: a task (with its subtree) to its folder, a childless code
 *   row through the factory gate. Exactly `dispatchReadiness`'s "ready".
 * - `epic` — an epic-shaped code row, which travels through `convert_to_code_epic` instead. Only
 *   the row can run it (the parent becomes the epic and its children the stories), which is why
 *   the bulk bar sends that shape here. It needs a project, not an epic hint — the conversion
 *   creates the epic — so an unset project just means the project dialog opens (`opensDialog`).
 * - `blocked` — not dispatchable yet, carrying the same blocker the bulk bar's readiness line
 *   names. `groupHasTempIds` covers the children the item alone can't see: the conversion RPC
 *   needs real ids for every row in the group.
 */
export type RowDispatchAction =
  | { kind: 'send' }
  | { kind: 'epic'; opensDialog: boolean }
  | { kind: 'blocked'; blocker: DispatchBlocker };

export function rowDispatchAction(
  item: DispatchCandidate,
  { hasChildren, groupHasTempIds }: { hasChildren: boolean; groupHasTempIds: boolean },
): RowDispatchAction {
  if (groupHasTempIds) return { kind: 'blocked', blocker: 'still saving' };
  if (item.item_type === 'code' && hasChildren && !isTempId(item.id)) {
    return { kind: 'epic', opensDialog: item.intended_project_id === null };
  }
  const readiness = dispatchReadiness(item, hasChildren);
  return readiness.ready ? { kind: 'send' } : { kind: 'blocked', blocker: readiness.blocker };
}

/** Singular / plural phrasing per blocker, so a grouped count reads as a sentence. */
const BLOCKER_PHRASES: Record<DispatchBlocker, { one: string; many: string }> = {
  'needs a type': { one: 'needs a type', many: 'need a type' },
  'needs a folder': { one: 'needs a folder', many: 'need a folder' },
  'needs a project': { one: 'needs a project', many: 'need a project' },
  'needs an epic': { one: 'needs an epic', many: 'need an epic' },
  'dispatch from its own row menu': {
    one: 'dispatch from its own row menu',
    many: 'dispatch from their own row menus',
  },
  'still saving': { one: 'still saving', many: 'still saving' },
};

/** The canonical group order — type first (the broadest gap), then the label gaps, then state. */
const BLOCKER_ORDER: DispatchBlocker[] = [
  'needs a type',
  'needs a folder',
  'needs a project',
  'needs an epic',
  'dispatch from its own row menu',
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
