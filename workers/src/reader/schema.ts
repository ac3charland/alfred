/**
 * The shape the summariser asks the model for, and the shape check the answer has to survive.
 *
 * Two halves that must not drift apart: the JSON schema sent as `output_config.format`, and the
 * type guard that reads the parsed body back. The schema constrains generation; the guard is what
 * decides whether a row is `done`. A structured-output answer that still fails the guard is a
 * content failure — `summarize.ts` files it as `counted` — so the guard is deliberately strict
 * about the things the schema cannot express and forgiving about nothing else.
 *
 * Budgets (word counts, bullet counts) live in the field DESCRIPTIONS and in the prompt, never as
 * `maxItems` / `maxLength`. The structured-output grammar accepts a subset of JSON Schema, and a
 * keyword it rejects is a 400 — identical for every post, on every tick, until someone notices.
 * The budgets that have to hold — the bullet ceiling and the further-reading ceiling — are
 * applied by `normalizeReaderSummary` after parsing instead of being asked of the grammar.
 */
import type { NumberedLink } from './links';
import type {
  ReaderFurtherReading,
  ReaderFurtherReadingPick,
  ReaderSummary,
  StoredReaderSummary,
} from './types';

/** The most bullets either list may carry into the database. Over-long lists are trimmed, not rejected. */
export const READER_MAX_BULLETS = 6;

/**
 * The most Further reading items a post may store. Above the bullets' six because a roundup can
 * fairly recommend more than six pieces; bounded because every item is output tokens (about 40
 * each, well inside `READER_MAX_TOKENS`).
 */
export const READER_MAX_FURTHER_READING = 10;

/**
 * The schema sent with every summarisation request. `additionalProperties: false` and an
 * exhaustive `required` on both objects are mandatory for structured outputs — every key is
 * listed, and `novel_ideas` answers "nothing new here" with an empty array rather than by being
 * absent, so abstention is a value the model can actually emit.
 */
export const READER_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'gist', 'overview'],
  properties: {
    headline: { type: 'string', description: 'What the post is about, in one line. ≤ 20 words.' },
    gist: {
      type: 'string',
      description:
        'The claim the post makes and whether it is a new take or a restatement — the "should I read this?" answer. ≤ 90 words.',
    },
    overview: {
      type: 'object',
      additionalProperties: false,
      required: ['novel_ideas', 'evidence', 'argument', 'who_should_read', 'further_reading'],
      properties: {
        novel_ideas: {
          type: 'array',
          items: { type: 'string' },
          description: 'The genuinely new ideas. 0–6 bullets; empty is a valid answer.',
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'The notable evidence, data or examples the post rests on. 0–6 bullets.',
        },
        argument: {
          type: 'string',
          description: 'The argument in order — the one-page alternative to reading. ≤ 300 words.',
        },
        who_should_read: {
          type: 'string',
          description: 'Who the full post is worth the time for. ≤ 40 words.',
        },
        further_reading: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['link', 'title', 'note'],
            properties: {
              link: { type: 'integer', description: 'The link’s number from the links block.' },
              title: {
                type: 'string',
                description: 'The linked piece’s name, not the anchor text.',
              },
              note: { type: 'string', description: 'What the post uses it for. ≤ 20 words.' },
            },
          },
          description:
            'Linked sources worth reading in full. 0–10 items, most posts none or a few; empty is a valid answer.',
        },
      },
    },
  },
} as const;

/** The schema's own type, so the request builder can hand it on without widening it to `unknown`. */
export type ReaderSummarySchema = typeof READER_SUMMARY_SCHEMA;

/**
 * An array of strings, and nothing else. A single string, a number in the list, or a bare JSON
 * `null` all fail: the row renders these as bullets, and a non-string would reach the UI as
 * `[object Object]`.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * A plain JSON object — not an array, and not a bare `null`.
 *
 * Loose `== undefined` on purpose: `typeof null === 'object'`, so without it a `null` would reach
 * the property reads below and throw, and this package bans writing the `null` literal in source.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value != undefined && typeof value === 'object' && !Array.isArray(value);
}

/** One raw pick: an integer link number, a title and a note. */
function isFurtherReadingPick(value: unknown): value is ReaderFurtherReadingPick {
  return (
    isObject(value) &&
    Number.isInteger(value['link']) &&
    typeof value['title'] === 'string' &&
    typeof value['note'] === 'string'
  );
}

/**
 * The `overview` half of the guard: five required keys, two lists of strings, two strings and
 * the list of picks.
 */
function isReaderOverview(value: unknown): value is ReaderSummary['overview'] {
  if (!isObject(value)) return false;
  const further = value['further_reading'];
  return (
    isStringArray(value['novel_ideas']) &&
    isStringArray(value['evidence']) &&
    typeof value['argument'] === 'string' &&
    typeof value['who_should_read'] === 'string' &&
    Array.isArray(further) &&
    further.every((pick) => isFurtherReadingPick(pick))
  );
}

/**
 * Does this parsed body actually carry a summary? Every required key present, strings where the
 * schema says string, arrays of strings where it says array. A miss here is what `summarize.ts`
 * records as the `schema` failure reason — counted, because it is content-shaped and a retry of
 * the same prompt may well produce a well-formed answer.
 */
export function isReaderSummary(value: unknown): value is ReaderSummary {
  if (!isObject(value)) return false;
  return (
    typeof value['headline'] === 'string' &&
    typeof value['gist'] === 'string' &&
    isReaderOverview(value['overview'])
  );
}

/**
 * The picks as stored: only numbers the post's links block really carried, each link once (the
 * first pick that names it), in link order — which is the post's own order — trimmed, with any
 * item whose title is blank dropped, and at most {@link READER_MAX_FURTHER_READING}. Each number
 * is then swapped for its URL, so a model-written address can never reach the database.
 */
function furtherReading(
  picks: readonly ReaderFurtherReadingPick[],
  links: readonly NumberedLink[],
): ReaderFurtherReading[] {
  const urls = new Map(links.map((link) => [link.n, link.url]));
  const byLink = new Map<number, ReaderFurtherReading>();
  for (const pick of picks) {
    const url = urls.get(pick.link);
    const title = pick.title.trim();
    if (url === undefined || title === '' || byLink.has(pick.link)) continue;
    byLink.set(pick.link, { url, title, note: pick.note.trim() });
  }
  // Sorted in place, on the fresh copy: `toSorted` is not in this package's ES2022 lib.
  const inLinkOrder = [...byLink.entries()];
  inLinkOrder.sort(([left], [right]) => left - right);
  return inLinkOrder.slice(0, READER_MAX_FURTHER_READING).map(([, item]) => item);
}

/**
 * Apply the budgets the schema cannot — at most six bullets per list, at most ten further-reading
 * items — and map the further-reading picks onto `links`, the numbered links the post's input
 * carried.
 *
 * Returns a fresh object rather than mutating, so the caller can hand the parsed body straight in
 * and store what comes out. Everything else is passed through untouched — an over-long `argument`
 * is the prompt's problem, not a reason to cut a sentence in half.
 */
export function normalizeReaderSummary(
  summary: ReaderSummary,
  links: readonly NumberedLink[],
): StoredReaderSummary {
  return {
    headline: summary.headline,
    gist: summary.gist,
    overview: {
      novel_ideas: summary.overview.novel_ideas.slice(0, READER_MAX_BULLETS),
      evidence: summary.overview.evidence.slice(0, READER_MAX_BULLETS),
      argument: summary.overview.argument,
      who_should_read: summary.overview.who_should_read,
      further_reading: furtherReading(summary.overview.further_reading, links),
    },
  };
}
