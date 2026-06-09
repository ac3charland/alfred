import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field definitions
// ---------------------------------------------------------------------------

const itemType = z.enum(['unclassified', 'task', 'code', 'knowledge']);
const itemStatus = z.enum(['active', 'completed']);
const uuid = z.uuid();
const nullableUuid = z.uuid().nullable();

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
    due_date: z.iso.datetime({ offset: true }).nullable().optional(),
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
  due_date: z.iso.datetime({ offset: true }).nullable().optional(),
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
