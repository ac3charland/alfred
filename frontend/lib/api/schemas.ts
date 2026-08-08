import { z } from 'zod';

/**
 * Make every optional property *exact-optional*: the key stays optional, but its value
 * type drops the implicit `undefined` that `z.infer` adds for `.optional()` fields.
 *
 * `z.infer` types an optional field as `field?: T | undefined`; under
 * `exactOptionalPropertyTypes` that explicit `undefined` is NOT assignable to an
 * exact-optional `field?: T` target (e.g. a `Partial<Item>`/DB `Update`, or a `Pick<>` of
 * one of these inferred input types — see `tasks-store`'s `TaskFieldPatch`). Wrapping the
 * inferred type in `ExactOptional` restores the exact-optional shape the hand-written
 * interfaces had, keeping these the single source of truth without re-introducing the
 * `| undefined` mismatch.
 */
type ExactOptional<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

// ---------------------------------------------------------------------------
// Shared field definitions
// ---------------------------------------------------------------------------

const itemType = z.enum(['unclassified', 'task', 'code', 'knowledge']);
const itemStatus = z.enum(['active', 'completed']);
const uuid = z.uuid();
const nullableUuid = z.uuid().nullable();
// Accept a date-only string ("2026-06-15", from <input type="date">) OR a full ISO
// datetime with offset. Postgres coerces the date to a timestamptz at midnight.
// Nullable so a PATCH can clear the column.
const dueDate = z.iso
  .date()
  .or(z.iso.datetime({ offset: true }))
  .nullable();
// Discrete task priority (ALF-37). Nullable so a PATCH can clear it (`{ priority: null }`).
const taskPriority = z.enum(['high', 'medium', 'low']).nullable();
/**
 * The description cap, shared by the zod schemas below and the `maxLength` the two authoring
 * surfaces put on their textarea — so the UI can never produce a body the API rejects. The DB
 * CHECK carries the same number: a description is destined to be re-sent on every classification
 * request, so an essay pasted into one folder would tax every future item.
 */
export const ENTITY_DESCRIPTION_MAX = 500;

/**
 * A folder's or project's description — the owner's standing statement of what belongs there
 * (ALF-179). Nullable so an emptied field clears the column instead of storing `''`.
 */
const entityDescription = z.string().max(ENTITY_DESCRIPTION_MAX).nullable();

// ---------------------------------------------------------------------------
// Recurrence (the RecurrenceRule shape — mirror of lib/recurrence/types)
// ---------------------------------------------------------------------------

const weekday = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const monthlyMode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('day_of_month') }),
  z.object({
    kind: z.literal('positional'),
    setpos: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(-1),
    ]),
    weekday,
  }),
]);

const recurrenceEnd = z.discriminatedUnion('type', [
  z.object({ type: z.literal('never') }),
  z.object({ type: z.literal('on_date'), until: z.iso.date() }),
  z.object({ type: z.literal('after'), count: z.number().int().min(1) }),
]);

/**
 * Zod mirror of `lib/recurrence` `RecurrenceRule`, with the cross-field invariants the type
 * alone can't express: `byweekday` is weekly-only and non-empty; `monthly` is monthly-only;
 * weekly rules carry days and monthly rules carry a mode. Persisted as JSONB on `items`.
 */
export const recurrenceSchema = z
  .object({
    freq: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1),
    byweekday: z.array(weekday).nonempty().optional(),
    monthly: monthlyMode.optional(),
    end: recurrenceEnd,
  })
  .refine((r) => r.byweekday === undefined || r.freq === 'weekly', {
    message: '"byweekday" is only valid for a weekly rule',
    path: ['byweekday'],
  })
  .refine((r) => r.freq !== 'weekly' || r.byweekday !== undefined, {
    message: 'a weekly rule requires a non-empty "byweekday"',
    path: ['byweekday'],
  })
  .refine((r) => r.monthly === undefined || r.freq === 'monthly', {
    message: '"monthly" is only valid for a monthly rule',
    path: ['monthly'],
  })
  .refine((r) => r.freq !== 'monthly' || r.monthly !== undefined, {
    message: 'a monthly rule requires a "monthly" mode',
    path: ['monthly'],
  });

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Body for POST /api/items.
 *
 * Accepts the structured form OR the raw Siri single-field form
 * (`{ text }`). When `text` is provided and `title` is not, `title` is
 * mapped from `text` and `raw_capture` is set to `text` as well.
 */
export const createItemSchema = z
  .object({
    /** Primary capture field for structured submissions. */
    title: z.string().min(1).optional(),
    /** Raw Siri shortcut text — maps to `title` + `raw_capture` when present. */
    text: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    source_url: z.url().nullable().optional(),
    raw_capture: z.string().nullable().optional(),
    item_type: itemType.optional(),
    due_date: dueDate.optional(),
    folder_id: nullableUuid.optional(),
    parent_id: nullableUuid.optional(),
    // The Inbox capture box's project-prefix match assigns a pre-factory, epic-free project
    // to a code-classified inbox item (mirrors folder_id/parent_id — nullable, optional).
    intended_project_id: nullableUuid.optional(),
    // Nullable so a create can omit it (one-shot task) or send null explicitly.
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .refine((data) => data.title !== undefined || data.text !== undefined, {
    message: 'Either "title" or "text" is required',
    path: ['title'],
  });

export type CreateItemInput = ExactOptional<z.infer<typeof createItemSchema>>;

/**
 * Body for PATCH /api/items/[id] — all fields optional.
 */
export const updateItemSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  source_url: z.url().nullable().optional(),
  due_date: dueDate.optional(),
  folder_id: nullableUuid.optional(),
  parent_id: nullableUuid.optional(),
  item_type: itemType.optional(),
  status: itemStatus.optional(),
  // Nullable so a PATCH can clear the rule (`{ recurrence: null }`).
  recurrence: recurrenceSchema.nullable().optional(),
  priority: taskPriority.optional(),
  // Manual subtask rank (ALF-117): a bare double is fine — it's a fractional position, not a
  // bounded value. The reorder gesture PATCHes it (often alongside a re-parent's parent_id).
  sort_order: z.number().optional(),
  // The pre-factory hints (nullable so a PATCH can clear them). The DB owns their coherence:
  // both are code-only CHECKs, and the epic must belong to the intended project (the 0027
  // constraint trigger) — so an incoherent pair is a loud write error, not silent corruption.
  intended_project_id: nullableUuid.optional(),
  intended_epic_id: nullableUuid.optional(),
  /**
   * Inbox residency as an INTENT, not a timestamp: `true` sends the item out of the Inbox,
   * `false` returns it, omitted leaves it where it is. The route authors the instant — no caller
   * has a reason to choose *when* an item was dispatched, and letting one backdate the column
   * would quietly corrupt the record of what triage actually did.
   *
   * It is not a column, so it never rides the route's field list; the route maps it onto
   * `dispatched_at`.
   */
  dispatched: z.boolean().optional(),
});

export type UpdateItemInput = ExactOptional<z.infer<typeof updateItemSchema>>;

/** The validated recurrence-rule shape (the JSONB column's parsed form). */
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/**
 * Body for POST /api/folders — name required.
 */
export const createFolderSchema = z.object({
  name: z.string().min(1),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;

/**
 * Body for PATCH /api/folders/[id] — every field optional (a rename, a reorder, a description,
 * or any combination). `sort_order` is the manual sidebar rank (ALF-153): a bare double, since
 * it's a fractional position rather than a bounded value. `description` says what belongs in the
 * folder (ALF-179); nullable so clearing it stores null rather than an empty string, and capped
 * at the same 500 chars the DB CHECK enforces so an over-long body is a 400 here rather than a
 * Postgres error mapped to a 500.
 *
 * The refine is a non-empty-body check rather than a list of field names (the `updateHabitSchema`
 * idiom): naming the fields means every field added here needs a second edit, and forgetting it
 * rejects the new field's PATCH with a 400 that reads like a store bug.
 */
export const updateFolderSchema = z
  .object({
    name: z.string().min(1).optional(),
    sort_order: z.number().optional(),
    description: entityDescription.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'No fields to update',
  });

export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

/**
 * A criterion's stable key: lowercase, underscore-separated, ≤ 32 chars. Stable, URL-safe, and
 * readable in a stored `results` blob. Generated from the label by the form, never typed —
 * renaming a criterion later leaves history intact because the key doesn't move.
 */
const criterionKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, {
  message: 'Key must start with a lowercase letter, then lowercase letters, digits or underscores',
});

/**
 * One criterion. The `kind` decides the fields: `boolean` is a bare yes/no and takes neither a
 * target nor a comparator; the three measured kinds require both. A discriminated union is what
 * makes "a boolean carrying a target" a validation error rather than a silently ignored field.
 */
const habitCriterionSchema = z.discriminatedUnion('kind', [
  // Strict, not stripping: a `target` sent on a boolean is a caller believing something the
  // model will never honour, and silently dropping it hides that until the day is scored.
  z.strictObject({
    key: criterionKey,
    label: z.string().trim().min(1),
    kind: z.literal('boolean'),
  }),
  z.strictObject({
    key: criterionKey,
    label: z.string().trim().min(1),
    kind: z.enum(['time', 'count', 'duration']),
    /** Minutes after local midnight for `time` (375 = 06:15); a plain count otherwise. */
    target: z.number().int(),
    comparator: z.enum(['lte', 'gte', 'eq']),
  }),
]);

/** ISO weekdays, 1 = Monday … 7 = Sunday — the numbering `habits.active_days` stores. */
const activeDays = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .refine((days) => new Set(days).size === days.length, {
    message: 'active_days must not repeat a weekday',
  });

/** A habit's whole criteria list. Shared by create and update: one definition of what counts. */
const habitCriteria = z
  .array(habitCriterionSchema)
  .min(1)
  .refine((criteria) => new Set(criteria.map((c) => c.key)).size === criteria.length, {
    // Duplicate keys would make a `results` blob ambiguous — two criteria, one slot.
    message: 'criteria keys must be unique within a habit',
  });

/** A rolling window is 7 days, so forgiving 8 is meaningless rather than merely generous. */
const habitAllowance = z.number().int().min(0).max(7);

/**
 * Body for POST /api/habits. Omitted `active_days` / `allowance` / `started_on` fall through to
 * the column defaults (all seven days, no allowance, today).
 */
export const createHabitSchema = z.object({
  name: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
  criteria: habitCriteria,
  active_days: activeDays.optional(),
  allowance: habitAllowance.optional(),
  started_on: z.iso.date().optional(),
});

/**
 * Body for PATCH /api/habits/[id] — every field optional, at least one required.
 *
 * `archived` is a BOOLEAN, never the timestamp: `archived_at` is a fact about when a habit was
 * retired, and it is load-bearing (scoring stops on or after it), so a caller free to post an
 * arbitrary instant could retroactively un-score a fortnight. The route stamps the instant, the
 * same way the entry route derives rather than accepts a status.
 *
 * `active_days` / `allowance` / `started_on` are accepted here but frozen once the habit has a
 * logged day — the route compares against the stored row and only refuses a real CHANGE, so an
 * idempotent resend of the values already on screen stays a no-op (see `lib/habits/edits`).
 */
export const updateHabitSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    notes: z.string().nullable().optional(),
    criteria: habitCriteria.optional(),
    active_days: activeDays.optional(),
    allowance: habitAllowance.optional(),
    started_on: z.iso.date().optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'No fields to update',
  });

// Plain `z.infer`, NOT `ExactOptional`: this type is what the ROUTE receives from the parser, so
// each optional field genuinely arrives as `T | undefined` — and that is exactly the shape
// `toUpdatePayload` wants. `ExactOptional` is for types used to BUILD a DB `Update` payload.
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;

// Plain `z.infer`, NOT `ExactOptional`: `name` and `criteria` are required here, and that
// mapped type turns every property optional — which would let a caller omit them.
export type CreateHabitInput = z.infer<typeof createHabitSchema>;

/** The validated criterion shape (one element of the `criteria` JSONB column). */
export type HabitCriterionInput = z.infer<typeof habitCriterionSchema>;

/**
 * Body for PUT /api/habits/[id]/entries — logging or correcting one day.
 *
 * A caller sends EVIDENCE, not a verdict: `results` are scored server-side and the derived
 * status is stored alongside them. `status` therefore accepts exactly one value — `skipped`,
 * which isn't a judgement about the criteria at all but a statement that the day shouldn't be
 * scored. Honouring any other stated status would let a row read `met` while carrying evidence
 * of a miss, with nothing downstream able to tell which was true.
 */
export const upsertHabitEntrySchema = z
  .object({
    /** The day being logged. Omitted ⇒ today, resolved through `tz`. */
    date: z.iso.date().optional(),
    /**
     * IANA zone used to resolve "today" when `date` is omitted. Deliberately a bare string:
     * an unrecognized zone degrades to UTC rather than 400-ing, exactly as `pr-ratio` does.
     */
    tz: z.string().optional(),
    results: z.record(z.string(), z.union([z.boolean(), z.number()])).optional(),
    status: z.literal('skipped').optional(),
    note: z.string().nullable().optional(),
  })
  .refine((body) => body.results !== undefined || body.status !== undefined, {
    message: 'Either "results" or "status" is required — there is nothing to record',
    path: ['results'],
  })
  .refine((body) => body.status !== 'skipped' || (body.note ?? '').trim() !== '', {
    // Skipping is the only way to keep a chain alive at no cost, so it takes a reason: a
    // frictionless skip is a button that launders a broken streak into an intact one.
    message: 'Skipping a day requires a non-empty "note" — the reason',
    path: ['note'],
  });

export type UpsertHabitEntryInput = ExactOptional<z.infer<typeof upsertHabitEntrySchema>>;

// ---------------------------------------------------------------------------
// Software Factory — projects / epics / code stories (the gate)
// ---------------------------------------------------------------------------

/** A project ref key: exactly 3 chars, leading uppercase letter then upper-alnum. */
const projectKey = z.string().regex(/^[A-Z][A-Z0-9]{2}$/, {
  message: 'Key must be exactly 3 characters: an uppercase letter then two letters or digits',
});

/**
 * Body for POST /api/projects. The route derives `repo_owner`/`repo_name` from the
 * GitHub URL (the `lib/code/github` parser) and persists the URL too. `key` is validated
 * against the key regex here; uniqueness is enforced by the DB `unique` constraint.
 */
export const createProjectSchema = z.object({
  name: z.string().min(1),
  github_url: z.url(),
  key: projectKey,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * Body for PATCH /api/projects/[id] — the description, and nothing else (ALF-179). `name`,
 * `key`, `github_url` and the repo fields stay as immutable as they are today: `key` is carried
 * by every ref, branch name and PR frontmatter, so renaming a project is a real feature with its
 * own consequences rather than a side effect of adding a text column. An object schema STRIPS
 * unknown keys, so a body naming any of them changes nothing.
 */
export const updateProjectSchema = z
  .object({
    description: entityDescription.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'No fields to update',
  });

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Body for POST /api/epics — calls the `create_epic` RPC (allocates the shared ref). */
export const createEpicSchema = z.object({
  project_id: uuid,
  name: z.string().min(1),
});

export type CreateEpicInput = z.infer<typeof createEpicSchema>;

/**
 * Body for PATCH /api/epics/[id] — the epic-header edits: `name` (inline rename),
 * `notes` (nullable so it clears to null) and `archived_at` (set to an ISO timestamp to
 * archive, null to un-archive, which drops/restores the epic on the active board). All
 * optional, but the `.refine` rejects an empty body so a PATCH must change something.
 */
export const updateEpicSchema = z
  .object({
    name: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    archived_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.notes !== undefined || data.archived_at !== undefined,
    {
      message: 'At least one of "name", "notes", or "archived_at" is required',
    },
  );

export type UpdateEpicInput = z.infer<typeof updateEpicSchema>;

/**
 * The **gate** shape for POST /api/code: admit a pre-existing item to the factory via
 * `enter_code_module(item, project, epic)`, which flips the item to `code`, clears its
 * task-only fields, and creates the sidecar at `needs_refinement` with a server-allocated ref.
 */
export const gateCodeSchema = z.object({
  item_id: uuid,
  project_id: uuid,
  epic_id: uuid,
});

/**
 * The **new-story** shape for POST /api/code: mint a brand-new story from the project view
 * via `create_code_story(project, epic, title, notes, requires_refinement)`, which inserts a
 * fresh item AND its `code_items` sidecar in one step (no inbox row to admit). `title` is
 * trimmed and required; `notes` is optional (the lib/ layer maps empty → null). No `item_id`
 * distinguishes it from the gate shape.
 *
 * `requires_refinement` is the New Story dialog's "Needs refinement" checkbox: omitted (or
 * `true`) the story lands at `needs_refinement` as it always has; `false` lands it straight in
 * `ready_for_dev`. Only this shape carries it — the gate has no such control, and an object
 * schema strips the unknown key, so a gate body naming it can never reach the RPC.
 */
export const newCodeStorySchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
  project_id: uuid,
  epic_id: uuid,
  requires_refinement: z.boolean().optional(),
});

/**
 * Body for POST /api/code — a union of the two creation shapes. The gate flips an existing
 * item; the new-story shape inserts a fresh one. Both produce a `code_items` sidecar (at
 * `needs_refinement`, unless the new-story shape clears `requires_refinement`) and return that
 * row, so they share one route (branch on `item_id`).
 */
export const createCodeSchema = z.union([gateCodeSchema, newCodeStorySchema]);

export type GateCodeInput = z.infer<typeof gateCodeSchema>;
export type NewCodeStoryInput = ExactOptional<z.infer<typeof newCodeStorySchema>>;
export type CreateCodeInput = z.infer<typeof createCodeSchema>;

/**
 * Body for POST /api/code/epic — the epic conversion: turn a 1-deep parent (a code inbox
 * item or a decomposed task) into a NEW epic plus one story per active child via
 * `convert_to_code_epic(item, project)`. Only a project is chosen — the epic is being
 * created (named after the parent), so there is no `epic_id`.
 */
export const convertCodeEpicSchema = z.object({
  item_id: uuid,
  project_id: uuid,
});

export type ConvertCodeEpicInput = z.infer<typeof convertCodeEpicSchema>;

/** Validated shape for GET /api/epics query string — optional `?project=` filter. */
export const listEpicsQuerySchema = z.object({
  project: uuid.optional(),
});

export type ListEpicsQuery = z.infer<typeof listEpicsQuerySchema>;

/** The eight factory states — the full set a manual/link-click transition may set. */
const codeFactoryState = z.enum([
  'needs_refinement',
  'in_refinement',
  'ready_for_dev',
  'in_development',
  'ready_for_review',
  'done',
  'blocked',
  'abandoned',
]);

/**
 * Body for PATCH /api/code/[ref] — a sidecar edit. Every field is optional, but the
 * `.refine` rejects an empty body so a PATCH must change something. `factory_state` drives
 * the state transition (the link-click write + the manual controls); `blocked_reason` is its
 * companion (nullable so it clears on any non-blocked hop); `epic_id` moves the story to a
 * different epic (the route guards same-project); `requires_refinement` records whether the
 * story still needs a spec. `blocked_reason` is a companion only — it never travels alone, so it
 * doesn't satisfy the "something to update" check, whereas `requires_refinement` does: marking a
 * story that is already in the right lane changes nothing else, and that is a legitimate write.
 */
export const updateCodeSchema = z
  .object({
    factory_state: codeFactoryState.optional(),
    blocked_reason: z.string().nullable().optional(),
    epic_id: uuid.optional(),
    requires_refinement: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.factory_state !== undefined ||
      data.epic_id !== undefined ||
      data.requires_refinement !== undefined,
    {
      message: 'At least one of "factory_state", "epic_id", or "requires_refinement" is required',
    },
  );

export type UpdateCodeInput = z.infer<typeof updateCodeSchema>;

/**
 * Body for POST /api/code/reorder — the Backlog chevron swap. `a` and `b` are story **refs**
 * (KEY-N, the code module's keying convention — NOT UUIDs, exactly as `PATCH /api/code/[ref]`
 * keys by ref), whose global `priority` the `swap_code_priority` RPC exchanges atomically. The
 * `.refine` rejects `a === b`: a story can't swap with itself, and a no-op swap is a wasted call.
 */
export const reorderCodeSchema = z
  .object({
    a: z.string().min(1),
    b: z.string().min(1),
  })
  .refine((data) => data.a !== data.b, {
    message: 'Cannot reorder a story with itself',
  });

export type ReorderCodeInput = z.infer<typeof reorderCodeSchema>;

/**
 * Body for POST /api/code/move — the Backlog double-chevron "jump to top / bottom". `ref` is the
 * story ref (KEY-N, keyed like the swap, NOT a UUID); `to_top` picks the end — `true` re-ranks it
 * above every other story, `false` below them all — which the `move_code_priority` RPC does in one
 * atomic UPDATE. Unlike the swap there is no second ref, so no self-reference `.refine` is needed.
 */
export const moveCodeSchema = z.object({
  ref: z.string().min(1),
  to_top: z.boolean(),
});

export type MoveCodeInput = z.infer<typeof moveCodeSchema>;

/**
 * Body for POST /api/code/move-project — the Backlog's project-scoped jump (ALF-110), which
 * repurposes the double-chevron button. Same shape as `moveCodeSchema`, but the story lands at
 * the top/bottom of its own project instead of the whole Backlog (`move_code_priority_in_project`).
 */
export const moveCodeInProjectSchema = z.object({
  ref: z.string().min(1),
  to_top: z.boolean(),
});

export type MoveCodeInProjectInput = z.infer<typeof moveCodeInProjectSchema>;

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

/**
 * Validated shape for GET /api/items query string.
 */
export const listItemsQuerySchema = z.object({
  folder: uuid.optional(),
  inbox: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  status: z.enum(['active', 'completed', 'all']).optional(),
});

export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

/**
 * Validated shape for GET /api/code/pr-ratio query string. `tz` is the IANA timezone the
 * rolling window's timestamps are rendered in — deliberately just a string: an unrecognized
 * zone degrades to UTC in `rollingWeekWindow` rather than 400-ing, because the endpoint's job
 * is a number, not timezone validation.
 */
export const prRatioQuerySchema = z.object({
  tz: z.string().optional(),
});

export type PrRatioQuery = z.infer<typeof prRatioQuerySchema>;

/**
 * Validated shape for GET /api/habits query string. `tz` is the IANA zone "today" is resolved
 * in — a bare string for the same reason `pr-ratio`'s is: an unrecognized zone degrades to UTC.
 *
 * `include_archived` is an explicit `'true' | 'false'` enum rather than `z.coerce.boolean()`,
 * under which `Boolean('false') === true` and a caller asking to exclude archived habits gets
 * the opposite of what they asked for.
 */
export const habitsQuerySchema = z
  .object({
    tz: z.string().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    include_archived: z.enum(['true', 'false']).optional(),
  })
  // Only the both-present case is decidable here; the rest of the window rules need today's
  // date, so they live in `resolveWindow` where they can be table-tested.
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
  });

export type HabitsQuery = z.infer<typeof habitsQuerySchema>;
