/**
 * Everything sent to the model for one classification, assembled without any I/O: the system
 * prompt text, the per-sweep JSON output schema, the reference date, and the few-shot block built
 * from the owner's past corrections. The caller that actually talks to Anthropic owns the network
 * call and the retry policy; this module only decides what the request says.
 *
 * Two things make this worth keeping pure and separately tested. First, the schema is rebuilt every
 * sweep from the live folder/project/epic ids, so a hallucinated id is not a case the caller has to
 * guard against — the model is simply never offered one. Second, the closed-world block and the
 * abstention rules are the highest-value place this prompt spends tokens: the schema constrains
 * WHICH ids are legal, but only the prompt text says how to choose between them, and when to say
 * nothing at all.
 */
import type { ClosedWorld, SweepItem, WorldEpic, WorldFolder, WorldProject } from './verdict';

/** The prompt version stamped onto every verdict. Bump BY HAND when the prompt text or the
 *  output schema changes meaningfully — it is what makes a prompt change safely replayable. */
export const PROMPT_VERSION = 1;

/** How many worked examples the few-shot block carries. */
export const EXAMPLE_LIMIT = 12;

/** One field the owner overrode at dispatch, as the correction log records it. */
export interface Correction {
  captured_text: string;
  field: string;
  direction: 'changed' | 'filled_in' | 'blanked';
  guessed_value: string | undefined;
  chosen_value: string | undefined;
}

/** Everything one classification request carries, ready to hand to the Anthropic client. */
export interface ClassifyRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

const ITEM_TYPES = ['task', 'code'];
const PRIORITIES = ['high', 'medium', 'low'];

/**
 * A `{ enum }` branch nullable via an explicit `{ type: 'null' }` sibling — never a bare
 * `{ type: 'null' }` swapped in by the *caller*, because `item_type` and `priority` always have a
 * fixed, non-empty value set. The empty-collapse case below exists only for the three id fields,
 * whose live lists can genuinely be empty on a fresh database.
 */
function nullableEnum(values: readonly string[]): Record<string, unknown> {
  if (values.length === 0) return { type: 'null' };
  return { anyOf: [{ enum: values }, { type: 'null' }] };
}

/**
 * The JSON Schema sent as `output_config.format.schema`, assembled from the live ids. Every field
 * is `required`; abstention is spelled by emitting the `null` branch, not by omitting the key,
 * because a strict schema wants every key present regardless of whether the model has an opinion.
 *
 * An empty id list collapses its field to a bare `{ type: 'null' }` rather than
 * `{ anyOf: [{ enum: [] }, ...] }` — an empty `enum` is not a valid JSON Schema, so a fresh
 * database with no folders yet must not produce one.
 */
export function buildSchema(world: ClosedWorld): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'item_type',
      'priority',
      'due_date',
      'folder_id',
      'intended_project_id',
      'intended_epic_id',
    ],
    properties: {
      item_type: nullableEnum(ITEM_TYPES),
      priority: nullableEnum(PRIORITIES),
      due_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
      folder_id: nullableEnum(world.folders.map((folder) => folder.id)),
      intended_project_id: nullableEnum(world.projects.map((project) => project.id)),
      intended_epic_id: nullableEnum(world.epics.map((epic) => epic.id)),
    },
  };
}

/**
 * Today, in the owner's zone, as `YYYY-MM-DD` plus its weekday spelled out. Resolving this in code,
 * once, is the whole point: the model is handed an absolute date and asked to reason from it, never
 * asked what day it is — which is exactly why "Friday" resolves the same way however long the
 * request happens to sit on the wire.
 */
export function referenceDate(timeZone: string, now: Date): { date: string; weekday: string } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
  return { date, weekday };
}

/** `<id>  <label>`, plus ` — <description>` when one is written. A folder/project with no
 *  description (absent or empty-string — the two are treated identically) renders the label alone:
 *  no dash, no "(no description)" placeholder, because either would read as the model's opinion
 *  rather than the owner's silence.
 *
 *  `description` is OPTIONAL rather than a required `string | undefined`: epics never carry one, and
 *  `unicorn/no-useless-undefined` autofixes a trailing `undefined` argument away — so a required
 *  parameter would be silently un-passed by `eslint --fix` and only fail on the next type-check. */
function describedLine(id: string, label: string, description?: string): string {
  if (description === undefined || description === '') return `${id}  ${label}`;
  return `${id}  ${label} — ${description}`;
}

function renderFolders(folders: readonly WorldFolder[]): string | undefined {
  if (folders.length === 0) return undefined;
  const lines = folders.map((folder) => describedLine(folder.id, folder.name, folder.description));
  return ['Folders (choose at most one, by id):', ...lines].join('\n');
}

function renderProjects(projects: readonly WorldProject[]): string | undefined {
  if (projects.length === 0) return undefined;
  const lines = projects.map((project) =>
    describedLine(project.id, `${project.key} · ${project.name}`, project.description),
  );
  return ['Projects (choose at most one, by id):', ...lines].join('\n');
}

/**
 * Epics are named, never described — and never carry `notes`. `epics.notes` is a free scratchpad on
 * a board card; feeding a scratchpad to the classifier as if it were a specification is how a prompt
 * starts quietly encoding whatever the owner last jotted down there. `WorldEpic` doesn't even carry
 * a notes field, so this is enforced at the type level, not just by this renderer's restraint.
 */
function renderEpics(epics: readonly WorldEpic[]): string | undefined {
  if (epics.length === 0) return undefined;
  // `undefined` stated explicitly rather than made optional on `describedLine`: an epic has no
  // description to pass, and an optional parameter would let a caller forget one that exists.
  const lines = epics.map((epic) => describedLine(epic.id, `${epic.ref} · ${epic.name}`));
  return ['Epics (choose at most one, by id):', ...lines].join('\n');
}

/** The closed-world block: one section per non-empty list, omitting a section entirely rather than
 *  printing an empty header when that list has nothing in it. */
function renderClosedWorld(world: ClosedWorld): string {
  return [renderFolders(world.folders), renderProjects(world.projects), renderEpics(world.epics)]
    .filter((section): section is string => section !== undefined)
    .join('\n\n');
}

/**
 * Written for a reader who has never heard of alfred — the model has no prior about this app, so the
 * preamble states the setting rather than naming it. Three things it must establish before any rule
 * below can be followed: WHERE this is happening (alfred, and what an Inbox capture is within it),
 * WHAT this step produces (metadata on one item — never an action taken on it), and WHY abstaining
 * is cheap while a confident wrong label is not. It also names the two `item_type` values against
 * the world they describe, which is what lets the abstention rule below say "work on alfred itself"
 * and be understood by a reader who has never seen this codebase.
 */
const SYSTEM_PREAMBLE =
  "alfred is one person's personal task system, and you are a step inside it. Its owner captures " +
  'thoughts as fast as they arrive — usually a single unlabelled line of text — into a holding list ' +
  'called the Inbox, then triages them later by hand: setting the fields on each one, then filing it ' +
  'somewhere. You go first, pre-filling those fields so that triage becomes a review instead of data ' +
  'entry. The owner also builds alfred itself, so a capture is sometimes an ordinary to-do (`task`) ' +
  "and sometimes a piece of work on alfred's own codebase (`code`).\n\n" +
  'You will be shown exactly one captured item. Decide the six fields the response schema defines: ' +
  'item_type, priority, due_date, folder_id, intended_project_id, and intended_epic_id. Every field ' +
  'may be null — null is always a legal answer, and often the correct one.\n\n' +
  'What you write is a suggestion recorded on the item while it stays in the Inbox: it files ' +
  'nothing, completes nothing, and the owner reviews every item and can overwrite anything you set. ' +
  'That is also why a wrong answer costs more than a blank one — a row that already looks decided ' +
  'gets skimmed past rather than read.';

/**
 * Given D8-style asymmetric costs (a blank field is one the owner was going to fill in anyway —
 * zero regression — while a confident wrong label is worse than nothing, because a row that looks
 * done gets skimmed past and dispatched), the prompt optimises for precision over recall.
 */
const ABSTENTION_RULES =
  'Abstain rather than guess. Optimise for precision and accept low recall:\n' +
  '- item_type: answer only when the text clearly reads as a task, or as work on alfred itself. It may stay null.\n' +
  '- due_date: answer only when the text actually states a date or a day. Never infer it from urgency.\n' +
  '- priority: answer only when the text itself signals it. No default guess.\n' +
  '- folder_id: answer only when exactly one existing folder is a clear fit. Never invent a folder.\n' +
  '- intended_project_id and intended_epic_id: answer only from the sets supplied below. Never invent either.\n\n' +
  'Never rewrite, tidy, or summarise the captured text. You are writing metadata only.';

function renderReferenceDate(ref: { date: string; weekday: string }): string {
  return (
    `Today is ${ref.weekday}, ${ref.date}, in the owner's local time zone. Resolve any relative ` +
    'day or date the text names against this date — never against anything else.'
  );
}

/** An id resolved to the human name the example teaches, for the three fields that carry one. A
 *  scalar field (item_type, priority, due_date) has no id to resolve — its value is already the
 *  human-readable answer. */
function resolveIdLabel(field: string, id: string, world: ClosedWorld): string | undefined {
  if (field === 'folder_id') return world.folders.find((folder) => folder.id === id)?.name;
  if (field === 'intended_project_id')
    return world.projects.find((project) => project.id === id)?.name;
  if (field === 'intended_epic_id') return world.epics.find((epic) => epic.id === id)?.name;
  return undefined;
}

/** One side (guessed or chosen) of a worked example: `none` when absent, the resolved name when the
 *  field is an id field, else the value as recorded. */
function resolveSide(field: string, value: string | undefined, world: ClosedWorld): string {
  if (value === undefined) return 'none';
  return resolveIdLabel(field, value, world) ?? value;
}

function renderExample(correction: Correction, world: ClosedWorld): string {
  const guessed = resolveSide(correction.field, correction.guessed_value, world);
  const chosen = resolveSide(correction.field, correction.chosen_value, world);
  return `Captured: "${correction.captured_text}"\nField: ${correction.field}\nGuessed: ${guessed}\nChosen: ${chosen}`;
}

/** The few-shot block, or `undefined` for an empty log — an item with no correction history simply
 *  gets today's prompt with nothing appended, rather than an empty "Examples:" header. */
function renderExamples(examples: readonly Correction[], world: ClosedWorld): string | undefined {
  if (examples.length === 0) return undefined;
  const blocks = examples.map((example) => renderExample(example, world));
  return [
    'Examples of past corrections — captured text, field, what was guessed, what you chose:',
    ...blocks,
  ].join('\n\n');
}

function buildSystemPrompt(
  world: ClosedWorld,
  examples: readonly Correction[],
  ref: { date: string; weekday: string },
): string {
  const sections = [
    SYSTEM_PREAMBLE,
    renderReferenceDate(ref),
    ABSTENTION_RULES,
    renderClosedWorld(world),
    renderExamples(examples, world),
  ];
  return sections
    .filter((section): section is string => section !== undefined && section.length > 0)
    .join('\n\n');
}

function buildUserMessage(item: SweepItem): string {
  const lines = [`Title: ${item.title}`];
  if (item.notes !== undefined) lines.push(`Notes: ${item.notes}`);
  if (item.raw_capture !== undefined) lines.push(`Captured text: ${item.raw_capture}`);
  if (item.source_url !== undefined) lines.push(`Source: ${item.source_url}`);
  return lines.join('\n');
}

type Direction = Correction['direction'];
const DRAW_ORDER: readonly Direction[] = ['blanked', 'changed', 'filled_in'];
/** The three id fields a correction can name — the only ones that need resolving against a live
 *  world before an example is safe to teach from. */
const ID_FIELDS = new Set(['folder_id', 'intended_project_id', 'intended_epic_id']);

function idResolves(field: string, id: string, world: ClosedWorld): boolean {
  if (field === 'folder_id') return world.folders.some((folder) => folder.id === id);
  if (field === 'intended_project_id') return world.projects.some((project) => project.id === id);
  if (field === 'intended_epic_id') return world.epics.some((epic) => epic.id === id);
  return true;
}

/** Whether a correction survives the closed-world filter: a scalar field always survives, and an id
 *  field survives only when every non-absent side of it still resolves — a correction naming a
 *  since-deleted folder is dropped rather than taught. */
function survivesWorld(correction: Correction, world: ClosedWorld): boolean {
  if (!ID_FIELDS.has(correction.field)) return true;
  const sides = [correction.guessed_value, correction.chosen_value].filter(
    (value): value is string => value !== undefined,
  );
  return sides.every((id) => idResolves(correction.field, id, world));
}

/**
 * The examples the few-shot block will carry, drawn round-robin across the three directions.
 *
 * A log dominated by "you left this blank and I filled it in" would nudge the model toward
 * guessing more — the exact failure abstention exists to prevent — so recency alone is not the
 * rule. Corrections whose ids no longer resolve are dropped BEFORE the draw, not after, so a
 * dropped example never costs a slot a resolvable one could have filled. What survives is
 * partitioned into the three direction buckets (each staying in the recency order it arrived in,
 * since `corrections` is assumed newest-first already) and drawn one-per-bucket in rotation,
 * skipping any bucket that has run dry, until `EXAMPLE_LIMIT` examples are collected or every
 * bucket is empty.
 */
export function selectExamples(corrections: Correction[], world: ClosedWorld): Correction[] {
  const survivors = corrections.filter((correction) => survivesWorld(correction, world));
  const buckets: Record<Direction, Correction[]> = {
    blanked: survivors.filter((correction) => correction.direction === 'blanked'),
    changed: survivors.filter((correction) => correction.direction === 'changed'),
    filled_in: survivors.filter((correction) => correction.direction === 'filled_in'),
  };
  const nextIndex: Record<Direction, number> = { blanked: 0, changed: 0, filled_in: 0 };

  const drawn: Correction[] = [];
  let madeProgress = true;
  while (drawn.length < EXAMPLE_LIMIT && madeProgress) {
    madeProgress = false;
    for (const direction of DRAW_ORDER) {
      if (drawn.length >= EXAMPLE_LIMIT) break;
      const bucket = buckets[direction];
      const candidate = bucket[nextIndex[direction]];
      if (candidate !== undefined) {
        drawn.push(candidate);
        nextIndex[direction] += 1;
        madeProgress = true;
      }
    }
  }
  return drawn;
}

/** Assemble everything one classification request carries: the system prompt (rules, the closed
 *  world, the few-shot block), the per-item user message, and the live output schema. */
export function buildRequest(input: {
  item: SweepItem;
  world: ClosedWorld;
  corrections: Correction[];
  timeZone: string;
  now: Date;
}): ClassifyRequest {
  const { item, world, corrections, timeZone, now } = input;
  const examples = selectExamples(corrections, world);
  return {
    system: buildSystemPrompt(world, examples, referenceDate(timeZone, now)),
    user: buildUserMessage(item),
    schema: buildSchema(world),
  };
}
