import { buildTree } from '@/lib/tree';
import type { CodeItem, CodeLane, Folder, Item, ItemPriority, ItemType } from '@/lib/types';

/**
 * The serializer for the weekly-plan cohort endpoints — the one place the published payload's
 * shape, its derived fields and its counts live. Pure: rows in, payload out, no I/O, so the
 * whole contract is table-testable and the route stays a thin auth-parse-read-respond shell
 * (the `lib/habits/payload` precedent).
 *
 * Its whole job is answering the three questions a weekly review asks of every line of last
 * week's plan — is this done, when was it done, and if not, where is it now — in ONE vocabulary
 * across item types. That needs deriving, because completion is task-only in this schema: a
 * task's is `items.status` / `items.completed_at`, a code story's is its `code_items` sidecar.
 * A payload that published both raw columns plus a done-count spanning both families would offer
 * two readings of one question, and the obvious one (`status`) reports every shipped story as
 * outstanding.
 */

/** The `code_items` columns the cohort read needs — identity plus the completion facts. */
export type WeeklyPlanCodeSidecar = Pick<
  CodeItem,
  'item_id' | 'ref' | 'lane' | 'factory_state' | 'done_at'
>;

/** The plan a cohort hangs off, as the payload echoes it. */
export interface WeeklyPlanRef {
  id: string;
  uploaded_at: string;
}

/**
 * One planned item. `state` is where it is now in one vocabulary: `active` / `completed` for a
 * task or an untyped capture, the story's `factory_state` once it is in the factory. `code` is
 * the sidecar's IDENTITY only — `ref` is what a review quotes ("RPL-142 is in review") and
 * `lane` says who is building it; the factory state is not repeated there, because `state` is
 * already it.
 */
export interface WeeklyPlanItemNode {
  id: string;
  item_type: ItemType;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: ItemPriority | null;
  state: string;
  done: boolean;
  done_at: string | null;
  created_at: string;
  folder: { id: string; name: string } | null;
  in_inbox: boolean;
  code: { ref: string; lane: CodeLane } | null;
  children: WeeklyPlanItemNode[];
}

/**
 * The cohort's aggregate. `done`, `open` and `abandoned` partition `total`; `untriaged`
 * CROSS-CUTS them (a done item may never have been dispatched), so it does not sum with them. A
 * high `untriaged` a week later is a finding in itself: the plan was written and never engaged
 * with.
 *
 * No overdue count: that needs a timezone and a notion of today, which would put date policy in
 * a payload whose consumer already has both.
 */
export interface WeeklyPlanItemCounts {
  total: number;
  done: number;
  open: number;
  abandoned: number;
  untriaged: number;
}

export interface WeeklyPlanItemsPayload {
  plan: WeeklyPlanRef | null;
  counts: WeeklyPlanItemCounts;
  items: WeeklyPlanItemNode[];
}

export interface WeeklyPlanItemsPayloadInput {
  /** The resolved cohort's plan, or null when no cohort exists at all. */
  plan: WeeklyPlanRef | null;
  /** Every `items` row carrying this plan's id — roots and children, flat. */
  items: Item[];
  /** The folders those rows reference. Only `id` and `name` reach the payload. */
  folders: Pick<Folder, 'id' | 'name'>[];
  /** The factory sidecars of whichever rows have entered the Software Factory. */
  code: WeeklyPlanCodeSidecar[];
}

/** The factory state a story is parked in when the owner gave up on it. */
const ABANDONED = 'abandoned';

/** The state a task-family row reports when it is still outstanding. */
const ACTIVE = 'active';

/**
 * The three derived fields, resolved per family. A `code` row answers from its sidecar; anything
 * else answers from its own status columns. A code item with NO sidecar was planned as code and
 * never entered the factory — it reports `active`, which is also what its `status` column says,
 * since the task-only CHECK forbids a non-task row from holding anything else.
 */
function deriveCompletion(
  item: Item,
  sidecar: WeeklyPlanCodeSidecar | undefined,
): Pick<WeeklyPlanItemNode, 'state' | 'done' | 'done_at'> {
  if (item.item_type === 'code') {
    if (sidecar === undefined) return { state: ACTIVE, done: false, done_at: null };
    return {
      state: sidecar.factory_state,
      done: sidecar.factory_state === 'done',
      done_at: sidecar.done_at,
    };
  }
  return {
    state: item.status,
    done: item.status === 'completed',
    done_at: item.completed_at,
  };
}

/** Everything about one node except its children, which the recursion supplies. */
function toNodeFields(
  item: Item,
  folders: Map<string, Pick<Folder, 'id' | 'name'>>,
  sidecars: Map<string, WeeklyPlanCodeSidecar>,
): Omit<WeeklyPlanItemNode, 'children'> {
  const folder = item.folder_id === null ? undefined : folders.get(item.folder_id);
  const sidecar = sidecars.get(item.id);
  return {
    id: item.id,
    item_type: item.item_type,
    title: item.title,
    notes: item.notes,
    due_date: item.due_date,
    priority: item.priority,
    ...deriveCompletion(item, sidecar),
    created_at: item.created_at,
    folder: folder === undefined ? null : { id: folder.id, name: folder.name },
    // Residency, not location: an item carrying a classifier's folder guess is still in the
    // Inbox until a human dispatches it (migration 0026).
    in_inbox: item.dispatched_at === null,
    code: sidecar === undefined ? null : { ref: sidecar.ref, lane: sidecar.lane },
  };
}

/** Walk every node of the forest, roots and descendants alike. */
function* walk(nodes: WeeklyPlanItemNode[]): Generator<WeeklyPlanItemNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children);
  }
}

/**
 * The counts, derived from the RENDERED nodes rather than the raw rows, so the aggregate and the
 * rows can never disagree about what "done" means — there is one rule, applied once.
 */
function countNodes(items: WeeklyPlanItemNode[]): WeeklyPlanItemCounts {
  const counts = { total: 0, done: 0, open: 0, abandoned: 0, untriaged: 0 };
  for (const node of walk(items)) {
    counts.total += 1;
    if (node.done) counts.done += 1;
    else if (node.state === ABANDONED) counts.abandoned += 1;
    else counts.open += 1;
    if (node.in_inbox) counts.untriaged += 1;
  }
  return counts;
}

/** The whole `GET /api/weekly-plans/[id]/items` body (and the create response's item list). */
export function toWeeklyPlanItemsPayload(
  input: WeeklyPlanItemsPayloadInput,
): WeeklyPlanItemsPayload {
  const folders = new Map(input.folders.map((folder) => [folder.id, folder]));
  const sidecars = new Map(input.code.map((sidecar) => [sidecar.item_id, sidecar]));

  // `buildTree` is the app's own nesting and ordering — roots newest-created first (which the
  // create RPC's descending timestamps make "the order the batch was sent"), each subtask group
  // by sort_order, and a child whose parent is missing lifted to a root rather than dropped. The
  // payload orders the cohort exactly as the app lists it, from the same function, so a review
  // reading the API and the owner reading the screen see one order.
  const toNode = (node: ReturnType<typeof buildTree>[number]): WeeklyPlanItemNode => ({
    ...toNodeFields(node, folders, sidecars),
    children: node.children.map((child) => toNode(child)),
  });

  const items = buildTree(input.items).map((node) => toNode(node));
  return { plan: input.plan, counts: countNodes(items), items };
}
