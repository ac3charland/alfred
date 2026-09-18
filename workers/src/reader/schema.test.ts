import {
  READER_MAX_BULLETS,
  READER_SUMMARY_SCHEMA,
  isReaderSummary,
  normalizeReaderSummary,
} from './schema';
import type { ReaderSummary } from './types';

/** A well-formed summary, the shape every test below varies one field of. */
function validSummary(): ReaderSummary {
  return {
    headline: 'Why the new inference cost curve changes hosting decisions',
    gist: 'Argues that per-token prices fell faster than latency improved, so the bottleneck moved.',
    overview: {
      novel_ideas: ['Latency, not price, now decides where a model runs.'],
      evidence: ['Cites a 12× price drop against a 1.4× latency improvement over eighteen months.'],
      argument: 'Prices fell; latency did not; therefore the hosting decision inverted.',
      who_should_read: 'Anyone choosing between hosted and self-run inference this quarter.',
    },
  };
}

/** The same object less one key — `delete` on a computed index is banned by the lint. */
function without(source: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

/** `JSON.parse` typed honestly, so the guard is fed `unknown` rather than `any`. */
function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

describe('READER_SUMMARY_SCHEMA', () => {
  it('requires every key and forbids extras on both objects', () => {
    expect(READER_SUMMARY_SCHEMA.additionalProperties).toBe(false);
    expect(READER_SUMMARY_SCHEMA.required).toEqual(['headline', 'gist', 'overview']);

    const overview = READER_SUMMARY_SCHEMA.properties.overview;
    expect(overview.additionalProperties).toBe(false);
    expect(overview.required).toEqual(['novel_ideas', 'evidence', 'argument', 'who_should_read']);
  });

  it('carries no maxItems or maxLength anywhere — a rejected keyword would be a 400 on every post', () => {
    const serialized = JSON.stringify(READER_SUMMARY_SCHEMA);
    expect(serialized).not.toContain('maxItems');
    expect(serialized).not.toContain('maxLength');
    expect(serialized).not.toContain('minItems');
  });

  it('types both bullet lists as arrays of strings', () => {
    const { novel_ideas, evidence } = READER_SUMMARY_SCHEMA.properties.overview.properties;
    expect(novel_ideas).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(evidence).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('states the budgets in the descriptions, since the grammar cannot hold them', () => {
    expect(READER_SUMMARY_SCHEMA.properties.headline.description).toContain('20 words');
    expect(READER_SUMMARY_SCHEMA.properties.gist.description).toContain('90 words');
    expect(READER_SUMMARY_SCHEMA.properties.overview.properties.novel_ideas.description).toContain(
      'empty is a valid answer',
    );
  });
});

describe('isReaderSummary', () => {
  it('accepts a well-formed document', () => {
    expect(isReaderSummary(validSummary())).toBe(true);
  });

  it('accepts an empty novel_ideas list — the honest answer for a consensus restatement', () => {
    const summary = validSummary();
    summary.overview.novel_ideas = [];
    expect(isReaderSummary(summary)).toBe(true);
  });

  it.each(['headline', 'gist', 'overview'])('rejects a body missing %s', (key) => {
    expect(isReaderSummary(without({ ...validSummary() }, key))).toBe(false);
  });

  it.each(['novel_ideas', 'evidence', 'argument', 'who_should_read'])(
    'rejects an overview missing %s',
    (key) => {
      const summary = validSummary();
      expect(isReaderSummary({ ...summary, overview: without(summary.overview, key) })).toBe(false);
    },
  );

  it('rejects a non-string bullet', () => {
    const summary = validSummary();
    expect(
      isReaderSummary({
        ...summary,
        overview: { ...summary.overview, novel_ideas: ['fine', 7] },
      }),
    ).toBe(false);
  });

  it('rejects a bullet list that is a bare string rather than an array', () => {
    const summary = validSummary();
    expect(
      isReaderSummary({ ...summary, overview: { ...summary.overview, evidence: 'one bullet' } }),
    ).toBe(false);
  });

  it('rejects a non-string headline', () => {
    expect(isReaderSummary({ ...validSummary(), headline: 12 })).toBe(false);
  });

  it('rejects a non-string argument', () => {
    const summary = validSummary();
    expect(
      isReaderSummary({ ...summary, overview: { ...summary.overview, argument: ['a', 'b'] } }),
    ).toBe(false);
  });

  it('rejects an array, a string and a number', () => {
    expect(isReaderSummary([])).toBe(false);
    expect(isReaderSummary('a summary')).toBe(false);
    expect(isReaderSummary(42)).toBe(false);
  });

  it('rejects a bare JSON null without throwing — typeof null is "object"', () => {
    // Raw JSON text, not a literal: the package bans `null` in source.
    expect(isReaderSummary(parseJson('null'))).toBe(false);
    expect(isReaderSummary(parseJson('{"headline":"a","gist":"b","overview":null}'))).toBe(false);
  });

  it('rejects a missing body', () => {
    const nothing: unknown = undefined;
    expect(isReaderSummary(nothing)).toBe(false);
  });
});

describe('normalizeReaderSummary', () => {
  it('trims each list to six bullets', () => {
    const summary = validSummary();
    summary.overview.novel_ideas = Array.from({ length: 9 }, (_, index) => `idea ${String(index)}`);
    summary.overview.evidence = Array.from({ length: 7 }, (_, index) => `fact ${String(index)}`);

    const trimmed = normalizeReaderSummary(summary);

    expect(trimmed.overview.novel_ideas).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.evidence).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.novel_ideas[0]).toBe('idea 0');
    expect(trimmed.overview.novel_ideas.at(-1)).toBe('idea 5');
  });

  it('leaves a short list, the strings and the headline untouched', () => {
    const summary = validSummary();
    expect(normalizeReaderSummary(summary)).toEqual(summary);
  });

  it('returns a fresh object rather than mutating the parsed body', () => {
    const summary = validSummary();
    summary.overview.evidence = Array.from({ length: 8 }, () => 'fact');

    normalizeReaderSummary(summary);

    expect(summary.overview.evidence).toHaveLength(8);
  });
});
