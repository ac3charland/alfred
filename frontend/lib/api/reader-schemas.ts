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

/**
 * The most research items one dispatch request takes. The route fires the research Routine once
 * per post, sequentially, each fire bounded by a 10 s timeout, so five fit inside the route's
 * 60 s budget; the Inbox store sends a bigger dispatch as several requests.
 */
export const RESEARCH_SEND_MAX = 5;

/**
 * Body for POST /api/reader/research — the research rows to consume into Reader posts and fire.
 * `.strict()`, so a stray key is a 400 rather than something silently ignored.
 */
export const sendItemsToResearchSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(RESEARCH_SEND_MAX),
  })
  .strict();

export type SendItemsToResearchInput = z.infer<typeof sendItemsToResearchSchema>;

/**
 * The longest report delivery accepts, in characters. The research skill asks for 1 200–3 000
 * words, so this is several times any honest report — a ceiling on a runaway session, not a
 * length the owner will ever meet.
 */
export const RESEARCH_REPORT_MAX_CHARS = 200_000;

/**
 * Body for PUT /api/reader/research/[id] — the research session's markdown report. NUL characters
 * are dropped: a Postgres text column cannot hold one, so a report carrying one (copied out of a
 * fetched PDF, say) would fail the write on every retry and never land. Blank after that is refused
 * (a delivery with nothing in it would land an empty post as done); otherwise the report is stored
 * as sent, untrimmed.
 */
export const researchReportSchema = z.object({
  report: z
    .string()
    .max(RESEARCH_REPORT_MAX_CHARS)
    .transform((report) => report.replaceAll('\u0000', ''))
    .refine((report) => report.trim() !== '', 'The report must not be blank'),
});

export type ResearchReportInput = z.infer<typeof researchReportSchema>;

/** The most links one Further reading send may name — the list's own ceiling. */
export const MAX_FURTHER_READING_SEND = 10;

/** An absolute `http:`/`https:` URL — the only kind a Further reading item carries. */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Body for POST /api/reader/posts/[id]/further-reading — save ticked Further reading links to
 * Instapaper: into its "To Reader" folder for the Reader to summarise (`reader`), or to Unread
 * (`instapaper`). One to ten links, each an absolute web URL; the route still checks every one
 * against the post's current list, so this only refuses what could never be a list item.
 */
export const sendFurtherReadingSchema = z
  .object({
    destination: z.enum(['reader', 'instapaper']),
    urls: z
      .array(z.string().refine(isWebUrl, 'Not a web link'))
      .min(1)
      .max(MAX_FURTHER_READING_SEND),
  })
  .strict();

export type SendFurtherReadingInput = z.infer<typeof sendFurtherReadingSchema>;
