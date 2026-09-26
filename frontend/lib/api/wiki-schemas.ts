import { z } from 'zod';

import { WIKI_PAGE_PATH } from '@/lib/wiki/sections';

/**
 * Request shapes for the wiki routes — their own file, mirroring `reader-schemas.ts`, re-exported
 * from `schemas.ts` so consumers keep one import path.
 */

/**
 * Query for GET /api/wiki/page. The path must be exactly a snapshotted page path — a section the
 * Worker syncs and one file stem — so the route can never be pointed at an arbitrary row or
 * used to probe for one.
 */
export const wikiPageQuerySchema = z.object({
  path: z.string().regex(WIKI_PAGE_PATH, 'Not a wiki page path'),
});

export type WikiPageQuery = z.infer<typeof wikiPageQuerySchema>;

/**
 * Query for GET /api/wiki/search. At least two characters: a one-letter query matches every
 * page and costs a full-text scan for a list nobody wants. The limit mirrors the RPC's default.
 */
export const wikiSearchQuerySchema = z.object({
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type WikiSearchQuery = z.infer<typeof wikiSearchQuerySchema>;

/**
 * Body for POST /api/reader/posts/[id]/wiki — the bullets to send, one to six non-blank strings
 * (an overview never holds more than a handful). `.strict()`, so a stray key is a 400 rather than
 * something silently ignored.
 */
export const sendReaderIdeasSchema = z
  .object({
    // Six is workers/src/reader/schema.ts `READER_MAX_BULLETS`, the most bullets an overview
    // stores; the two packages share no code, so the number is repeated here.
    // A refine, not `.trim()`: the route matches each idea exactly against the post's bullets, so
    // a whitespace-only one is refused while every other idea keeps its text as sent.
    ideas: z
      .array(z.string().refine((idea) => idea.trim() !== '', 'An idea must not be blank'))
      .min(1)
      .max(6),
  })
  .strict();

export type SendReaderIdeasInput = z.infer<typeof sendReaderIdeasSchema>;

/**
 * Body for POST /api/wiki/items — the knowledge rows to dispatch, one commit for all of them.
 * Fifty is the bulk bar's outer bound; a bigger dispatch is not one gesture.
 */
export const sendItemsToWikiSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(50),
  })
  .strict();

export type SendItemsToWikiInput = z.infer<typeof sendItemsToWikiSchema>;
