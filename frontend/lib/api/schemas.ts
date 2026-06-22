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
});

export type UpdateItemInput = ExactOptional<z.infer<typeof updateItemSchema>>;

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
 * Body for POST /api/code — the gate. Calls `enter_code_module(item, project, epic)`,
 * which flips the item to `code`, clears its task-only fields, and creates the sidecar
 * at `needs_refinement` with a server-allocated ref.
 */
export const createCodeSchema = z.object({
  item_id: uuid,
  project_id: uuid,
  epic_id: uuid,
});

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
