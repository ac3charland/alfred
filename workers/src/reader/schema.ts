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
 * The budgets that have to hold are the bullet ceiling and the Further reading ceiling, so
 * `normalizeReaderSummary` trims the three lists after parsing instead of asking the grammar to
 * enforce them.
 */
import type { NumberedLink } from './links';
import type { ReaderFurtherReading, ReaderFurtherReadingPick, ReaderOverview } from './types';

/** The most Further reading items a summary may carry into the database. Over-long lists are cut, not rejected. */
export const READER_MAX_FURTHER_READING = 10;

/** The most bullets either list may carry into the database. Over-long lists are trimmed, not rejected. */
export const READER_MAX_BULLETS = 6;

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
              link: {
                type: 'integer',
                description: 'The number of the link in the links block. Never a URL.',
              },
              title: {
                type: 'string',
                description: 'The title of the linked piece, not the anchor text. ≤ 15 words.',
              },
              note: {
                type: 'string',
                description: 'What this post uses the linked piece for. ≤ 20 words.',
              },
            },
          },
          description:
            'The linked pieces worth reading in full, by link number. 0–10 items; empty is the right answer when nothing qualifies, and always when the links block says none.',
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

/** One Further reading pick: an integer link number, and two strings. A URL in `link` fails. */
function isFurtherReadingPick(value: unknown): value is ReaderFurtherReadingPick {
  return (
    isObject(value) &&
    Number.isInteger(value['link']) &&
    typeof value['title'] === 'string' &&
    typeof value['note'] === 'string'
  );
}

/**
 * The summary as the model returns it: the stored shape's overview, but with Further reading
 * naming links by number. It exists only between the guard and `normalizeReaderSummary`.
 */
export interface RawReaderSummary {
  headline: string;
  gist: string;
  overview: Omit<ReaderOverview, 'further_reading'> & {
    further_reading: ReaderFurtherReadingPick[];
  };
}

/**
 * The summary as it is stored: Further reading is always present and carries URLs. Assignable to
 * `ReaderSummary`, whose field stays optional for rows written before it existed.
 */
export interface StoredReaderSummary {
  headline: string;
  gist: string;
  overview: Omit<ReaderOverview, 'further_reading'> & { further_reading: ReaderFurtherReading[] };
}

/**
 * The `overview` half of the guard: four required keys, two lists of strings, two strings, and
 * the Further reading list — required, because the schema makes it so and a row that lacks it
 * would be indistinguishable from one written before the field existed.
 */
function isRawOverview(value: unknown): value is RawReaderSummary['overview'] {
  if (!isObject(value)) return false;
  return (
    isStringArray(value['novel_ideas']) &&
    isStringArray(value['evidence']) &&
    typeof value['argument'] === 'string' &&
    typeof value['who_should_read'] === 'string' &&
    Array.isArray(value['further_reading']) &&
    value['further_reading'].every((entry) => isFurtherReadingPick(entry))
  );
}

/**
 * Does this parsed body actually carry a summary? Every required key present, strings where the
 * schema says string, arrays of strings where it says array, and Further reading as an array of
 * `{ link: integer, title, note }`. A miss here is what `summarize.ts` records as the `schema`
 * failure reason — counted, because it is content-shaped and a retry of the same prompt may well
 * produce a well-formed answer.
 */
export function isReaderSummary(value: unknown): value is RawReaderSummary {
  if (!isObject(value)) return false;
  return (
    typeof value['headline'] === 'string' &&
    typeof value['gist'] === 'string' &&
    isRawOverview(value['overview'])
  );
}

/**
 * Apply the budgets the schema cannot, and turn link numbers into URLs.
 *
 * Bullets: at most six per list. Further reading: a pick survives only when its number is one the
 * model was actually given (so an invented or mis-numbered pick drops out rather than pointing
 * anywhere), the first pick of a number wins, the survivors are ordered by number — document
 * order, the order the post makes them in — and at most ten are kept; a title that trims to
 * nothing is no item at all. The URL stored is the one in `links`, never anything the model typed.
 *
 * Returns a fresh object rather than mutating, so the caller can hand the parsed body straight in
 * and store what comes out. Everything else is passed through untouched — an over-long `argument`
 * is the prompt's problem, not a reason to cut a sentence in half.
 */
export function normalizeReaderSummary(
  summary: RawReaderSummary,
  links: readonly NumberedLink[],
): StoredReaderSummary {
  const urls = new Map(links.map((link) => [link.n, link.url]));
  const picked = new Map<number, ReaderFurtherReadingPick>();
  for (const pick of summary.overview.further_reading) {
    if (urls.has(pick.link) && !picked.has(pick.link)) picked.set(pick.link, pick);
  }
  const furtherReading: ReaderFurtherReading[] = [];
  const ordered = [...picked.values()];
  ordered.sort((left, right) => left.link - right.link);
  for (const pick of ordered) {
    const url = urls.get(pick.link);
    const title = pick.title.trim();
    if (url === undefined || title === '') continue;
    furtherReading.push({ url, title, note: pick.note.trim() });
  }

  return {
    headline: summary.headline,
    gist: summary.gist,
    overview: {
      novel_ideas: summary.overview.novel_ideas.slice(0, READER_MAX_BULLETS),
      evidence: summary.overview.evidence.slice(0, READER_MAX_BULLETS),
      argument: summary.overview.argument,
      who_should_read: summary.overview.who_should_read,
      further_reading: furtherReading.slice(0, READER_MAX_FURTHER_READING),
    },
  };
}
