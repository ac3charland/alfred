import { z } from 'zod';

/**
 * Request shapes for the Comms module's routes — its own file rather than a section of
 * `schemas.ts`, because the queue and the settings surfaces are built independently and would
 * otherwise be editing the same block. `schemas.ts` re-exports everything here, so consumers
 * keep one import path.
 *
 * As everywhere else, these schemas are the single source of truth for the input types: the
 * route handlers parse through them and the client wrappers take `z.infer` of them.
 */

/** The four triage tiers, mirroring the `comm_tier` enum. */
const commTier = z.enum(['asap', 'today', 'whenever', 'fyi']);

/** How important a roster person is, mirroring the `comm_people.priority` CHECK. */
const commPersonPriority = z.enum(['high', 'normal', 'low']);

/** A handle is an address or a phone number, mirroring the `comm_handles.kind` CHECK. */
const commHandleKind = z.enum(['email', 'phone']);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Query for GET /api/comms/messages. `scope` says which side of the module is being read —
 * the response queue or the FYI shelf — because the shelf is thousands of rows and the queue
 * is meant to be a handful; one endpoint answering both without saying which would make the
 * expensive read the default.
 */
export const commMessagesQuerySchema = z.object({
  scope: z.enum(['queue', 'shelf']),
  /** Cap on rows returned. The shelf is browsed a page at a time; the queue never needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type CommMessagesQuery = z.infer<typeof commMessagesQuerySchema>;

/**
 * Body for POST /api/comms/messages/[id]/clear — the owner's two clearing verbs.
 *
 * They are separate values, not one "dismiss", because only one of them is a correction:
 * "Nothing to answer" says the model was wrong to queue the row and is recorded as an example,
 * while "Not replying" says the model was right and the owner is declining. The other two
 * exits are never sent here — a detected reply is written by the poller, and making an Inbox
 * item clears the row through its own endpoint.
 */
export const clearMessageSchema = z.object({
  exit: z.enum(['nothing_to_answer', 'not_replying']),
});

export type ClearMessageInput = z.infer<typeof clearMessageSchema>;

/** Body for POST /api/comms/messages/[id]/tier — the owner overriding the model's tier. */
export const changeTierSchema = z.object({
  tier: commTier,
});

export type ChangeTierInput = z.infer<typeof changeTierSchema>;

/**
 * Body for POST /api/comms/purge — the deliberate "I want this gone": one message, one
 * account, or everything before a date. At least one selector is required; a bodiless purge
 * would be a request to delete the whole mirror by accident.
 */
export const purgeSchema = z
  .object({
    message_id: z.uuid().optional(),
    account_id: z.uuid().optional(),
    /** Purge messages that arrived strictly before this instant. */
    before: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (body) =>
      body.message_id !== undefined || body.account_id !== undefined || body.before !== undefined,
    { message: 'A purge needs a message, an account, or a cutoff' },
  );

export type PurgeInput = z.infer<typeof purgeSchema>;

// ---------------------------------------------------------------------------
// People — the roster the classifier weighs a sender against
// ---------------------------------------------------------------------------

/** One handle as the create/add forms send it. Normalisation happens server-side. */
export const commHandleInputSchema = z.object({
  handle: z.string().trim().min(1),
  kind: commHandleKind,
});

export type CommHandleInput = z.infer<typeof commHandleInputSchema>;

/**
 * Body for POST /api/comms/people. `priority` defaults to `high` — the same default the column
 * carries, because the roster exists to name the people whose messages matter, and a person
 * added with no stated priority is being added for that reason.
 *
 * Handles may be empty: a person can be created first and given addresses afterwards.
 */
export const createPersonSchema = z.object({
  name: z.string().trim().min(1),
  priority: commPersonPriority.default('high'),
  notes: z.string().nullable().optional(),
  handles: z.array(commHandleInputSchema).default([]),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;

/**
 * Body for PATCH /api/comms/people/[id] — every field optional, at least one required. Handles
 * are NOT edited here: they are added and removed one at a time through their own endpoints, so
 * a rename can never silently drop an address.
 */
export const updatePersonSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    priority: commPersonPriority.optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;

/** Body for POST /api/comms/people/[id]/handles — one more address or number for a person. */
export const addHandleSchema = commHandleInputSchema;

export type AddHandleInput = z.infer<typeof addHandleSchema>;

// ---------------------------------------------------------------------------
// Rubric + examples
// ---------------------------------------------------------------------------

/**
 * Body for POST /api/comms/rubric. The table is append-only, so saving an edit writes a NEW
 * version rather than replacing one — every verdict names the version that produced it, and
 * "why did it say that" has to stay answerable after an edit. The caller never states the
 * version number; the writer assigns it.
 */
export const createRubricVersionSchema = z.object({
  body: z.string().trim().min(1),
});

export type CreateRubricVersionInput = z.infer<typeof createRubricVersionSchema>;

/**
 * Body for PATCH /api/comms/examples/[id] — take an example out of the set, or put it back.
 * A boolean rather than a DELETE: the correction row itself is history and is never destroyed,
 * and both directions bump the example-set version.
 */
export const pruneExampleSchema = z.object({
  pruned: z.boolean(),
});

export type PruneExampleInput = z.infer<typeof pruneExampleSchema>;
