import { z } from 'zod';

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

export type CreateItemInput = z.infer<typeof createItemSchema>;

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

export type UpdateItemInput = z.infer<typeof updateItemSchema>;

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
 * Body for PATCH /api/code/[ref] — a state transition. `factory_state` is required;
 * `blocked_reason` is the optional companion the Block control sets (nullable so it clears on
 * any non-blocked hop). Drives both the M5 link-click write and M6's manual controls.
 */
export const updateCodeSchema = z.object({
  factory_state: codeFactoryState,
  blocked_reason: z.string().nullable().optional(),
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
