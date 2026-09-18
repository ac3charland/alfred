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
 * The one budget that has to hold is the bullet ceiling, so `normalizeReaderSummary` trims the
 * two lists after parsing instead of asking the grammar to enforce it.
 */
import type { ReaderOverview, ReaderSummary } from './types';

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
      required: ['novel_ideas', 'evidence', 'argument', 'who_should_read'],
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

/** The `overview` half of the guard: four required keys, two lists of strings, two strings. */
function isReaderOverview(value: unknown): value is ReaderOverview {
  if (!isObject(value)) return false;
  return (
    isStringArray(value['novel_ideas']) &&
    isStringArray(value['evidence']) &&
    typeof value['argument'] === 'string' &&
    typeof value['who_should_read'] === 'string'
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
 * Apply the one budget the schema cannot: at most six bullets per list.
 *
 * Returns a fresh object rather than mutating, so the caller can hand the parsed body straight in
 * and store what comes out. Everything else is passed through untouched — an over-long `argument`
 * is the prompt's problem, not a reason to cut a sentence in half.
 */
export function normalizeReaderSummary(summary: ReaderSummary): ReaderSummary {
  return {
    headline: summary.headline,
    gist: summary.gist,
    overview: {
      novel_ideas: summary.overview.novel_ideas.slice(0, READER_MAX_BULLETS),
      evidence: summary.overview.evidence.slice(0, READER_MAX_BULLETS),
      argument: summary.overview.argument,
      who_should_read: summary.overview.who_should_read,
    },
  };
}
