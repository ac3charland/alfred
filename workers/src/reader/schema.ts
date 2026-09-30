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
 * The budgets that have to hold — the bullet ceiling and the Further reading ceiling — are applied
 * by `normalizeReaderSummary` after parsing instead of asking the grammar to enforce them.
 */
import type { NumberedLink } from './links';
import type {
  ReaderFurtherReading,
  ReaderFurtherReadingPick,
  ReaderModelOverview,
  ReaderSummary,
  StoredReaderSummary,
} from './types';

/** The most bullets either list may carry into the database. Over-long lists are trimmed, not rejected. */
export const READER_MAX_BULLETS = 6;

/**
 * The most Further reading items a post keeps. More than the bullet ceiling, because a roundup's
 * worthwhile items run longer than six; bounded, because ten items at ~40 output tokens each is
 * what fits comfortably inside the call's `max_tokens`.
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
              link: {
                type: 'integer',
                description: 'The number of the link in the post’s links list.',
              },
              title: { type: 'string', description: 'The linked piece’s own name.' },
              note: {
                type: 'string',
                description: 'What the post uses it for. ≤ 20 words.',
              },
            },
          },
          description:
            'Linked sources worth reading in full. 0–10 items; empty is the common, correct answer.',
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

/** One Further reading pick: a whole link number, a title and a note. */
function isFurtherReadingPick(value: unknown): value is ReaderFurtherReadingPick {
  if (!isObject(value)) return false;
  return (
    Number.isInteger(value['link']) &&
    typeof value['title'] === 'string' &&
    typeof value['note'] === 'string'
  );
}

/**
 * The `overview` half of the guard: five required keys — two lists of strings, two strings, and
 * the list of Further reading picks.
 */
function isReaderOverview(value: unknown): value is ReaderModelOverview {
  if (!isObject(value)) return false;
  const furtherReading = value['further_reading'];
  return (
    isStringArray(value['novel_ideas']) &&
    isStringArray(value['evidence']) &&
    typeof value['argument'] === 'string' &&
    typeof value['who_should_read'] === 'string' &&
    Array.isArray(furtherReading) &&
    furtherReading.every((entry) => isFurtherReadingPick(entry))
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
 * The model's picks as stored items: only titled picks of numbers the post's list holds, each
 * link once (the first titled pick wins), in link order — which is document order — with blank titles dropped, capped at
 * {@link READER_MAX_FURTHER_READING}, and mapped to the URL each number stands for. A number the
 * list doesn't hold is dropped rather than failing the summary: every stored URL is then one the
 * post really contains, and the rest of an otherwise good answer still lands.
 */
function furtherReadingOf(
  picks: readonly ReaderFurtherReadingPick[],
  links: readonly NumberedLink[],
): ReaderFurtherReading[] {
  const urls = new Map(links.map((link) => [link.n, link.url]));
  // Blank titles go before the dedupe, so a titled repeat of a link can stand in for them.
  const firstPick = new Map<number, ReaderFurtherReadingPick>();
  for (const entry of picks) {
    if (entry.title.trim() === '' || !urls.has(entry.link) || firstPick.has(entry.link)) continue;
    firstPick.set(entry.link, entry);
  }
  // Sorted in place, on the fresh copy: `toSorted` is not in this package's ES2022 lib.
  const ordered = [...firstPick.values()];
  ordered.sort((left, right) => left.link - right.link);

  const items: ReaderFurtherReading[] = [];
  for (const entry of ordered) {
    const url = urls.get(entry.link);
    if (url === undefined) continue;
    items.push({ url, title: entry.title.trim(), note: entry.note.trim() });
  }
  return items.slice(0, READER_MAX_FURTHER_READING);
}

/**
 * Apply the budgets the schema cannot — at most six bullets per list, at most ten Further reading
 * items — and turn the Further reading picks' link numbers into the URLs they stand for, from the
 * post's own numbered `links`.
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
      further_reading: furtherReadingOf(summary.overview.further_reading, links),
    },
  };
}
