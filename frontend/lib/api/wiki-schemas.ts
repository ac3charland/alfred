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
 * One section's picks: up to six non-blank strings. Six is workers/src/reader/schema.ts
 * `READER_MAX_BULLETS`, the most bullets an overview stores in either list; the two packages
 * share no code, so the number is repeated here. A refine, not `.trim()`: the route matches each
 * bullet exactly against the post's overview, so a whitespace-only one is refused while every
 * other bullet keeps its text as sent.
 */
const readerPicksList = z
  .array(z.string().refine((bullet) => bullet.trim() !== '', 'A bullet must not be blank'))
  .max(6);

/**
 * Body for POST /api/reader/posts/[id]/wiki — the Novel-ideas and Evidence bullets to send in one
 * commit. Either list may be left out (a tab on an older bundle posts `{ ideas }` alone), but the
 * two together must name at least one bullet. `.strict()`, so a stray key is a 400 rather than
 * something silently ignored.
 */
export const sendReaderPicksSchema = z
  .object({
    ideas: readerPicksList.optional(),
    evidence: readerPicksList.optional(),
  })
  .strict()
  .refine(
    ({ ideas = [], evidence = [] }) => ideas.length + evidence.length > 0,
    'Pick at least one bullet',
  );

export type SendReaderPicksInput = z.infer<typeof sendReaderPicksSchema>;

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
