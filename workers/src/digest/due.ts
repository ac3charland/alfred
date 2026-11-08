/**
 * The digest's Due list: exactly the Today view's rule — which top-level tasks are due today or
 * already late, and in what order — plus the short label each row carries.
 *
 * A TWIN of `frontend/lib/tasks/due-today.ts` (`rankDueToday`) over `buildTree`, ranked by
 * `rankNodes(…, compareKeyByDue)` from `frontend/lib/priority.ts`. Workers cannot import from the
 * frontend, so the rule is ported here; `due.test.ts` carries the frontend suite's cases as a
 * parity table, and a change to either side must change both.
 *
 * Dates are floating `YYYY-MM-DD` and times floating `HH:MM[:SS]`, so nothing here reads a zone:
 * the caller passes "today" as the local date it already resolved.
 */
import { formatTime } from '../notify/format';

/** One `task_items` row as `digest_facts` returns it. */
export interface DigestTaskRow {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: 'high' | 'medium' | 'low' | null;
  due_date: string | null;
  due_time: string | null;
  created_at: string;
}

/** The label after a row's title. `late` rows render in italics. */
export interface DueLabel {
  text: string;
  late: boolean;
}

/** One row of the Due list. */
export interface DueRow {
  title: string;
  label?: DueLabel;
}

interface Node extends DigestTaskRow {
  children: Node[];
}

/** Ordering key: the due moment (Infinity when undated), then the priority rank. */
interface Key {
  due: number;
  rank: number;
  /** The date the moment came from, so the label can tell whose it is. */
  date: string | null;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** Milliseconds in a day — floating dates are compared as UTC midnights. */
const DAY_MS = 86_400_000;

function utcMidnight(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * The moment a task falls due, as a sortable number: a timed task at its minute, an untimed one
 * at the last millisecond of its day (after that day's timed tasks, before the next day's).
 */
function dueMoment(date: string, time: string | null): number {
  const midnight = utcMidnight(date);
  if (time === null) return midnight + DAY_MS - 1;
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return midnight + (hours * 60 + minutes) * 60_000;
}

function ownKey(node: DigestTaskRow): Key {
  return {
    due: node.due_date === null ? Infinity : dueMoment(node.due_date, node.due_time),
    rank: node.priority === null ? 3 : RANK[node.priority],
    date: node.due_date,
  };
}

/** Due first (earliest wins), then the level. Compares rather than subtracts: ∞ − ∞ is NaN. */
function compareKey(a: Key, b: Key): number {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.rank - b.rank;
}

/** The best key across the task and its active descendants, at any depth. */
function effectiveKey(node: Node): Key {
  let key = ownKey(node);
  for (const child of node.children) {
    if (child.status !== 'active') continue;
    const childKey = effectiveKey(child);
    if (compareKey(childKey, key) < 0) key = childKey;
  }
  return key;
}

/** Whether the task, or an active task beneath it, is due on or before `today`. */
function isDueInSubtree(node: Node, today: string): boolean {
  if (node.due_date !== null && node.due_date <= today) return true;
  return node.children.some((child) => child.status === 'active' && isDueInSubtree(child, today));
}

/** Stable insertion sort — `Array#sort` is banned and `toSorted` is past the ES2022 target. */
function stableSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const sorted: T[] = [];
  for (const item of items) {
    const at = sorted.findIndex((existing) => compare(existing, item) > 0);
    if (at === -1) sorted.push(item);
    else sorted.splice(at, 0, item);
  }
  return sorted;
}

/**
 * The forest's roots, newest first (the order `buildTree` leaves them in, which a full tie
 * preserves). A row whose parent is not in the list is a root, as it is there.
 */
function buildRoots(rows: readonly DigestTaskRow[]): Node[] {
  const nodes = new Map<string, Node>(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? undefined : nodes.get(node.parent_id);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return stableSorted(roots, (a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((utcMidnight(later) - utcMidnight(earlier)) / DAY_MS);
}

/**
 * The label: lateness when the effective date is past (whose — the task's or a subtask's), else
 * the task's own time when it is due today with one, else "subtask due" when only a subtask is.
 */
function labelFor(node: Node, key: Key, today: string): DueLabel | undefined {
  const date = key.date ?? today;
  if (date < today) {
    if (date !== node.due_date) return { text: 'subtask late', late: true };
    const days = daysBetween(date, today);
    return { text: days === 1 ? '1 day late' : `${String(days)} days late`, late: true };
  }
  if (node.due_date === today) {
    return node.due_time === null ? undefined : { text: formatTime(node.due_time), late: false };
  }
  return { text: 'subtask due', late: false };
}

/**
 * The Due list for `today` (`YYYY-MM-DD`): the active top-level tasks due today or late, by their
 * own date or an active subtask's, most overdue first, then by time, the level breaking a tie and
 * `created_at` (oldest first) the last word. `rows` should hold every active task plus any
 * non-active direct parent of one, so a subtree under a completed task stays hidden.
 */
export function rankDue(rows: readonly DigestTaskRow[], today: string): DueRow[] {
  const keyed = buildRoots(rows)
    .filter((node) => node.status === 'active' && isDueInSubtree(node, today))
    .map((node) => ({ node, key: effectiveKey(node) }));
  return stableSorted(
    keyed,
    (a, b) =>
      compareKey(a.key, b.key) || Date.parse(a.node.created_at) - Date.parse(b.node.created_at),
  ).map(({ node, key }) => {
    const label = labelFor(node, key, today);
    return label === undefined ? { title: node.title } : { title: node.title, label };
  });
}
