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
 * Body for PATCH /api/folders/[id] — name required (rename only).
 */
export const updateFolderSchema = z.object({
  name: z.string().min(1),
});

export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

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
 * via `create_code_story(project, epic, title, notes)`, which inserts a fresh item AND its
 * `code_items` sidecar in one step (no inbox row to admit). `title` is trimmed and required;
 * `notes` is optional (the lib/ layer maps empty → null). No `item_id` distinguishes it from
 * the gate shape.
 */
export const newCodeStorySchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
  project_id: uuid,
  epic_id: uuid,
});

/**
 * Body for POST /api/code — a union of the two creation shapes. The gate flips an existing
 * item; the new-story shape inserts a fresh one. Both produce a `code_items` sidecar at
 * `needs_refinement` and return that row, so they share one route (branch on `item_id`).
 */
export const createCodeSchema = z.union([gateCodeSchema, newCodeStorySchema]);

export type GateCodeInput = z.infer<typeof gateCodeSchema>;
export type NewCodeStoryInput = ExactOptional<z.infer<typeof newCodeStorySchema>>;
export type CreateCodeInput = z.infer<typeof createCodeSchema>;

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
 * different epic (the route guards same-project). `blocked_reason` is a companion only — it
 * never travels alone, so it doesn't satisfy the "something to update" check.
 */
export const updateCodeSchema = z
  .object({
    factory_state: codeFactoryState.optional(),
    blocked_reason: z.string().nullable().optional(),
    epic_id: uuid.optional(),
  })
  .refine((data) => data.factory_state !== undefined || data.epic_id !== undefined, {
    message: 'At least one of "factory_state" or "epic_id" is required',
  });

export type UpdateCodeInput = z.infer<typeof updateCodeSchema>;

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
