/**
 * The classifier's data contract, and the two pure steps that stand between a model response
 * and a legal database write.
 *
 * The output schema already closes the value space at generation time — the folder/project/epic
 * ids are sent as enums, so an invented id is not something the model can emit. This module is
 * the second layer, and it earns its place three ways the schema cannot: it closes the TIME gap
 * (a folder can be deleted between assembling the prompt and writing the answer back), it holds
 * the cross-field rules an enum cannot express, and being pure and deterministic it is the seam
 * the test suite gates. The database is the third and final layer, and it has the last word.
 *
 * `undefined`, never `null`, is how absence is spelled in here: the Worker package bans the
 * `null` literal, and `JSON.stringify` drops undefined keys — so a verdict doubles as a PATCH
 * body in which "no opinion" simply isn't sent.
 */

/** The values `items.item_type` may take that mean a decision was made. */
export type ItemType = 'task' | 'code';

/** The values `items.priority` may take. */
export type Priority = 'high' | 'medium' | 'low';

/**
 * One classification of one item. Every field may be absent: abstention is a first-class answer,
 * and given that guesses are written straight onto the item's real fields, a blank the owner was
 * going to fill anyway costs nothing while a confident wrong label is worse than nothing.
 */
export interface Verdict {
  item_type: ItemType | undefined;
  /** Task-only. */
  priority: Priority | undefined;
  /** Task-only. `YYYY-MM-DD`, written verbatim; `items.due_date` casts it to UTC midnight. */
  due_date: string | undefined;
  /** Task-only. */
  folder_id: string | undefined;
  /** Code-only. */
  intended_project_id: string | undefined;
  /** Code-only. */
  intended_epic_id: string | undefined;
}

/** The six fields a verdict can carry — the same six the dispatch-time diff compares. */
export const VERDICT_FIELDS = [
  'item_type',
  'priority',
  'due_date',
  'folder_id',
  'intended_project_id',
  'intended_epic_id',
] as const satisfies readonly (keyof Verdict)[];

/** A folder the model may choose, with the owner-written sentence saying what belongs in it. */
export interface WorldFolder {
  id: string;
  name: string;
  description: string | undefined;
}

/** A project the model may choose. `key` is the immutable 3-char ref prefix, e.g. `ALF`. */
export interface WorldProject {
  id: string;
  key: string;
  name: string;
  description: string | undefined;
}

/**
 * An epic the model may choose. Named, never described: `epics.notes` is a free scratchpad on a
 * board card, and feeding a scratchpad to the classifier as if it were a specification is how a
 * prompt starts quietly encoding whatever the owner last jotted down.
 */
export interface WorldEpic {
  id: string;
  ref: string;
  name: string;
  project_id: string;
}

/** Everything the model is allowed to choose from, read fresh at the start of each sweep. */
export interface ClosedWorld {
  folders: WorldFolder[];
  projects: WorldProject[];
  epics: WorldEpic[];
}

/**
 * One eligible Inbox item, as the sweep reads it. `item_type` is the raw column, so it may be
 * `unclassified` — the absence of a decision rather than a decision to leave it blank.
 */
export interface SweepItem {
  id: string;
  title: string;
  notes: string | undefined;
  raw_capture: string | undefined;
  source_url: string | undefined;
  item_type: string;
  priority: string | undefined;
  due_date: string | undefined;
  folder_id: string | undefined;
  intended_project_id: string | undefined;
  intended_epic_id: string | undefined;
  classify_attempts: number;
}

/**
 * Why one classification produced no verdict. Two of these are faults of the DEPLOY rather than of
 * the item — `credentials` (no key, or a 401/403) and `bad_request` (the API rejected the request
 * shape or the model id) — and both abort the whole tick instead of burning an attempt on every
 * eligible row. That distinction is the reason this union exists rather than a boolean.
 *
 * Without it, a systemic 400 is indistinguishable from an outage: every eligible item would count
 * a failure every tick, and at a two-minute cadence the whole Inbox is past the ceiling inside ten
 * minutes — permanently, since nothing resets the counter. The first real request this feature
 * ever makes happens in production, because no suite is allowed to call the live API, so the
 * request shape being wrong is a first-deploy possibility rather than a hypothetical.
 *
 * The accepted cost: one genuinely item-specific 400 (an oversized capture, say) stalls the sweep
 * until someone looks. For a single-user system that is the better failure — a stuck sweep names
 * its cause on the first `wrangler tail`, while a silently opted-out Inbox looks like a feature
 * that simply does nothing.
 */
export type ClassifyFailure =
  | { reason: 'credentials'; detail: string }
  | { reason: 'bad_request'; detail: string }
  | { reason: 'transport'; detail: string }
  | { reason: 'refusal' }
  | { reason: 'truncated' }
  | { reason: 'unparseable'; detail: string };

/** A classification attempt's outcome: one verdict, or one typed reason there isn't one. */
export type ClassifyOutcome = { ok: Verdict } | { failed: ClassifyFailure };

const PRIORITIES = new Set<string>(['high', 'medium', 'low']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read a field of a parsed JSON object as a string, treating JSON `null` as absence. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Shape-check a parsed model response. Returns `undefined` when the body is not an object —
 * everything narrower (an unknown folder id, a priority that isn't one of the three) is a field
 * to drop rather than a response to reject, which is what `validateVerdict` is for.
 *
 * The schema makes every key required, so a missing one already means something went wrong; the
 * tolerant read here is deliberate belt-and-braces, not a second contract.
 */
export function parseVerdict(raw: unknown): Verdict | undefined {
  // Loose `== undefined` on purpose: it is the only way to catch a JSON `null` body without
  // writing the `null` literal this package bans, and `typeof null === 'object'` would otherwise
  // let a bare `null` response through to a property read that throws.
  if (raw == undefined || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;

  const itemType = readString(body, 'item_type');
  const priority = readString(body, 'priority');
  return {
    item_type: itemType === 'task' || itemType === 'code' ? itemType : undefined,
    priority:
      priority !== undefined && PRIORITIES.has(priority) ? (priority as Priority) : undefined,
    due_date: readString(body, 'due_date'),
    folder_id: readString(body, 'folder_id'),
    intended_project_id: readString(body, 'intended_project_id'),
    intended_epic_id: readString(body, 'intended_epic_id'),
  };
}

/** `YYYY-MM-DD` naming a real calendar day — `2026-02-30` parses as a string but is not a date. */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Drop every field of `verdict` that is not legal against `world`, keeping the coherent core.
 * No rule rejects the whole verdict: a wrong folder costs the folder, not the priority.
 *
 * The cross-field rules mirror the database's CHECK constraints exactly
 * (`items_task_only_fields`, `items_intended_project_code_only`, `items_intended_epic_code_only`
 * and the epic/project coherence trigger), so a validated verdict is always a legal write.
 */
export function validateVerdict(verdict: Verdict, world: ClosedWorld): Verdict {
  const folderIds = new Set(world.folders.map((folder) => folder.id));
  const projectIds = new Set(world.projects.map((project) => project.id));
  const epicsById = new Map(world.epics.map((epic) => [epic.id, epic]));

  // What this layer is actually for. It does NOT close the gap between building the prompt and
  // writing the answer: `world` is one snapshot per tick, and the same object built the schema's
  // enums, so a folder deleted after the snapshot passes here exactly as it passed there. The
  // database is what refuses that write, and the next tick's fresh world stops offering the id.
  // What this catches is the model answering outside its schema at all — a structured-output
  // failure — and it is the one place the cross-field rules live.
  const folder = keepIf(verdict.folder_id, (id) => folderIds.has(id));
  const project = keepIf(verdict.intended_project_id, (id) => projectIds.has(id));
  let epic = keepIf(verdict.intended_epic_id, (id) => epicsById.has(id));

  // An epic belongs to a project, so an epic without one — or under a different one — is
  // incoherent however live both ids are. The database raises on this; drop it first.
  if (
    epic !== undefined &&
    (project === undefined || epicsById.get(epic)?.project_id !== project)
  ) {
    epic = undefined;
  }

  const isTask = verdict.item_type === 'task';
  const isCode = verdict.item_type === 'code';
  return {
    item_type: verdict.item_type,
    priority: isTask ? verdict.priority : undefined,
    due_date: isTask ? keepIf(verdict.due_date, isCalendarDate) : undefined,
    folder_id: isTask ? folder : undefined,
    intended_project_id: isCode ? project : undefined,
    intended_epic_id: isCode ? epic : undefined,
  };
}

/** `value` when it passes `predicate`, else absent. */
function keepIf(
  value: string | undefined,
  predicate: (value: string) => boolean,
): string | undefined {
  return value !== undefined && predicate(value) ? value : undefined;
}

/**
 * The item's own decision about its type, or absent when nobody has made one. `unclassified` is
 * the column's default and the shape every capture arrives in, so it is emphatically not a value
 * the classifier must leave alone.
 *
 * Exported because the prompt asks the same question the merge does: a row that already holds a
 * type is told so, and has that type pinned in its output schema, precisely so the verdict it
 * gets back is one the merge can use. Two readings of "has the owner decided?" would be one
 * rename away from disagreeing.
 */
export function decidedType(item: SweepItem): ItemType | undefined {
  return item.item_type === 'task' || item.item_type === 'code' ? item.item_type : undefined;
}

/**
 * Reduce a validated verdict to the fields the classifier may actually write: the ones the item
 * does not already hold. The classifier fills gaps and never overwrites — an `ALF:`-prefixed
 * capture arrives already `code` with a project set, so it is eligible and should usefully gain
 * an epic or a priority, but the project a human's prefix chose is not the classifier's to change.
 *
 * The type the row will END UP with decides which fields are legal, not the type the model
 * guessed: keeping an existing `code` while writing a task-shaped due date is exactly the
 * incoherent row `items_task_only_fields` refuses.
 *
 * The same "end up with" rule has to be applied to the epic, which is why this needs `world`.
 * `validateVerdict` checked the epic against the VERDICT's project; if the item already holds a
 * different one, that project is the one being kept and the epic is now orphaned under it. 0027's
 * `items_intended_epic_project` is a DEFERRED constraint trigger, so it raises at commit and takes
 * the whole PATCH down — losing the coherent fields alongside the incoherent one, and burning an
 * attempt on an item whose next tick gets the identical prompt and plausibly guesses the same way.
 */
export function mergeIntoItem(verdict: Verdict, item: SweepItem, world: ClosedWorld): Verdict {
  const existingType = decidedType(item);
  const finalType = existingType ?? verdict.item_type;
  const gap = (held: string | undefined, guessed: string | undefined): string | undefined =>
    held === undefined ? guessed : undefined;

  const project = gap(item.intended_project_id, verdict.intended_project_id);
  let epic = gap(item.intended_epic_id, verdict.intended_epic_id);
  // The project the ROW will hold, which is the held one whenever there is one — precisely the
  // case where it differs from the one the epic was validated against.
  const finalProject = item.intended_project_id ?? project;
  if (epic !== undefined) {
    const owner = world.epics.find((candidate) => candidate.id === epic)?.project_id;
    if (owner !== finalProject) epic = undefined;
  }

  return {
    item_type: existingType === undefined ? verdict.item_type : undefined,
    priority:
      finalType === 'task'
        ? (gap(item.priority, verdict.priority) as Priority | undefined)
        : undefined,
    due_date: finalType === 'task' ? gap(item.due_date, verdict.due_date) : undefined,
    folder_id: finalType === 'task' ? gap(item.folder_id, verdict.folder_id) : undefined,
    intended_project_id: finalType === 'code' ? project : undefined,
    intended_epic_id: finalType === 'code' ? epic : undefined,
  };
}
