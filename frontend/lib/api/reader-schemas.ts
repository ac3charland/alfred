import { z } from 'zod';

/**
 * Request shapes for the Reader module's routes — its own file rather than a section of
 * `schemas.ts`, mirroring `comms-schemas.ts`: the reading list is built independently of the
 * rest of the app and would otherwise be editing the same block. `schemas.ts` re-exports
 * everything here, so consumers keep one import path.
 */

/**
 * Query for GET /api/reader/posts. `scope` defaults to `active` — the list the owner reads is
 * the whole point of the endpoint, and the archive is a later surface nobody calls this for yet —
 * so an absent `scope` should not turn into an accidental 400 or an accidental archive read.
 * `limit` mirrors the list's own hard cap (500) rather than Comms' 1000: the seed reads 200 and
 * this is the same table.
 */
export const readerPostsQuerySchema = z.object({
  scope: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ReaderPostsQuery = z.infer<typeof readerPostsQuerySchema>;

/**
 * Body for PATCH /api/reader/posts/[id] — the reading list's three verbs, and only three:
 * archive (either direction — Unarchive sends `archived: false`), mark-opened, and re-summarise.
 * A `z.union` of `.strict()` objects rather than one object of optional fields, because each
 * verb stamps different columns and a body that named two (`{ archived: true, opened: true }`)
 * would be ambiguous about which timestamp matters — `.strict()` on each branch rejects the
 * extra key instead of silently taking the first one. `opened` and `resummarize` are
 * `z.literal(true)` because neither has an inverse: the store never sends `{ opened: false }`,
 * so that shape has no meaning to accept.
 */
export const patchReaderPostSchema = z.union([
  z.object({ archived: z.boolean() }).strict(),
  z.object({ opened: z.literal(true) }).strict(),
  z.object({ resummarize: z.literal(true) }).strict(),
]);

export type PatchReaderPostInput = z.infer<typeof patchReaderPostSchema>;

/**
 * A bare `local@domain` shape with both parts non-empty — just enough to reject a handle that
 * can't be an email address at all (no `@`, or nothing on one side of it). `<` and `>` are also
 * rejected so a display-name-wrapped address pasted straight from a mail client
 * (`<news@example.com>`) fails here instead of silently becoming part of the local or domain
 * part. `createReaderPublication` still does the real work of deriving the local part and domain
 * from whatever passes this.
 */
const HANDLE_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

/**
 * Body for POST /api/reader/publications — putting a sender on the roster by hand, either from
 * the candidates list or typed in. Only the handle is required: it is the join key every match
 * is made on, so it is trimmed here and normalised further server-side, while the display name
 * falls back to something derived from the handle rather than being demanded of the owner.
 */
export const createReaderPublicationSchema = z.object({
  handle: z.string().trim().min(1).regex(HANDLE_PATTERN, 'Not an email address'),
  name: z.string().trim().min(1).optional(),
});

export type CreateReaderPublicationInput = z.infer<typeof createReaderPublicationSchema>;

/**
 * Body for PATCH /api/reader/publications/[id] — every field optional, at least one required
 * (an empty PATCH has nothing to apply). The handle is NOT editable: it is what every post is
 * matched on, so changing it would orphan a publication's history rather than rename it. A note
 * is nullable because clearing one is a real edit; a name is not, because a card with no name
 * has nothing to render.
 */
export const updateReaderPublicationSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export type UpdateReaderPublicationInput = z.infer<typeof updateReaderPublicationSchema>;
