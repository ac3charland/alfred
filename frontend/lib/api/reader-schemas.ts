import { z } from 'zod';

/**
 * Request shapes for the Reader module's routes — its own file rather than a section of
 * `schemas.ts`, mirroring `comms-schemas.ts`: the reading list is built independently of the
 * rest of the app and would otherwise be editing the same block. `schemas.ts` re-exports
 * everything here, so consumers keep one import path.
 */

/**
 * Query for GET /api/reader/posts. `scope` defaults to `active` — the list the owner reads is
 * the whole point of the endpoint, and the archive is a S2 surface nobody calls this for yet —
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
 * Body for PATCH /api/reader/posts/[id] — the reading list's two verbs, and only two: archive
 * (either direction) and mark-opened. A `z.union` of two `.strict()` objects rather than one
 * object of optional fields, because the two verbs stamp two different columns and a body that
 * named both (`{ archived: true, opened: true }`) would be ambiguous about which timestamp
 * matters — `.strict()` on each branch rejects the extra key instead of silently taking the
 * first one. `opened` is `z.literal(true)` because there is no "un-open": the store never sends
 * `{ opened: false }`, so that shape has no meaning to accept.
 */
export const patchReaderPostSchema = z.union([
  z.object({ archived: z.boolean() }).strict(),
  z.object({ opened: z.literal(true) }).strict(),
]);

export type PatchReaderPostInput = z.infer<typeof patchReaderPostSchema>;
