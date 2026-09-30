import type { NumberedLink } from './links';
import {
  READER_MAX_BULLETS,
  READER_MAX_FURTHER_READING,
  READER_SUMMARY_SCHEMA,
  isReaderSummary,
  normalizeReaderSummary,
} from './schema';
import type { ReaderFurtherReadingPick, ReaderSummary } from './types';

/** A post's numbered links, `https://example.com/<n>` for each number up to `count`. */
function numbered(count: number): NumberedLink[] {
  return Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    url: `https://example.com/${String(index + 1)}`,
  }));
}

/** A pick of link `link`, titled and noted after it. */
function pick(link: number, title = `Piece ${String(link)}`): ReaderFurtherReadingPick {
  return { link, title, note: `Why link ${String(link)} matters.` };
}

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
      further_reading: [],
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
    expect(overview.required).toEqual([
      'novel_ideas',
      'evidence',
      'argument',
      'who_should_read',
      'further_reading',
    ]);
  });

  it('asks for further reading as link NUMBERS with a title and a note, and no extras', () => {
    const { further_reading } = READER_SUMMARY_SCHEMA.properties.overview.properties;
    expect(further_reading).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['link', 'title', 'note'],
        properties: {
          link: { type: 'integer' },
          title: { type: 'string' },
          note: { type: 'string' },
        },
      },
    });
    expect(further_reading.description).toContain('empty');
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

  it.each(['novel_ideas', 'evidence', 'argument', 'who_should_read', 'further_reading'])(
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

  it('accepts further reading picks of a whole link number, a title and a note', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(3), pick(1)];
    expect(isReaderSummary(summary)).toBe(true);
  });

  it.each([
    ['a fractional link number', { link: 1.5, title: 't', note: 'n' }],
    ['a link number as a string', { link: '2', title: 't', note: 'n' }],
    ['a pick missing its note', { link: 2, title: 't' }],
    ['a pick whose title is not a string', { link: 2, title: 4, note: 'n' }],
    ['a bare string', 'https://example.com/1'],
  ])('rejects further reading holding %s', (_label, entry) => {
    const summary = validSummary();
    expect(
      isReaderSummary({ ...summary, overview: { ...summary.overview, further_reading: [entry] } }),
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

    const trimmed = normalizeReaderSummary(summary, []);

    expect(trimmed.overview.novel_ideas).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.evidence).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.novel_ideas[0]).toBe('idea 0');
    expect(trimmed.overview.novel_ideas.at(-1)).toBe('idea 5');
  });

  it('leaves a short list, the strings and the headline untouched', () => {
    const summary = validSummary();
    expect(normalizeReaderSummary(summary, [])).toEqual(summary);
  });

  it('returns a fresh object rather than mutating the parsed body', () => {
    const summary = validSummary();
    summary.overview.evidence = Array.from({ length: 8 }, () => 'fact');

    normalizeReaderSummary(summary, []);

    expect(summary.overview.evidence).toHaveLength(8);
  });
});

describe('normalizeReaderSummary — further reading', () => {
  it('maps each pick to the URL its number stands for', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(2, 'The paper')];

    expect(normalizeReaderSummary(summary, numbered(3)).overview.further_reading).toEqual([
      { url: 'https://example.com/2', title: 'The paper', note: 'Why link 2 matters.' },
    ]);
  });

  it('drops a number the post’s list does not hold, so every stored URL is one the post contains', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(0), pick(2), pick(9), pick(-1)];

    const urls = normalizeReaderSummary(summary, numbered(3)).overview.further_reading.map(
      (item) => item.url,
    );

    expect(urls).toEqual(['https://example.com/2']);
  });

  it('keeps nothing when the post had no links at all', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(1)];

    expect(normalizeReaderSummary(summary, []).overview.further_reading).toEqual([]);
  });

  it('dedupes by number, keeping the first pick, and sorts into link (document) order', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(3), pick(1, 'First'), pick(3, 'Again'), pick(2)];

    const items = normalizeReaderSummary(summary, numbered(3)).overview.further_reading;

    expect(items.map((item) => item.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
    expect(items[2]?.title).toBe('Piece 3');
  });

  it(`caps the list at ${String(READER_MAX_FURTHER_READING)}, after sorting`, () => {
    const summary = validSummary();
    summary.overview.further_reading = Array.from({ length: 14 }, (_, index) => pick(14 - index));

    const items = normalizeReaderSummary(summary, numbered(14)).overview.further_reading;

    expect(items).toHaveLength(READER_MAX_FURTHER_READING);
    expect(items[0]?.url).toBe('https://example.com/1');
    expect(items.at(-1)?.url).toBe('https://example.com/10');
  });

  it('trims titles and notes, and drops an item whose title is blank', () => {
    const summary = validSummary();
    summary.overview.further_reading = [
      { link: 1, title: ' '.repeat(3), note: 'No title.' },
      { link: 2, title: '  The paper  ', note: '  Its numbers.  ' },
    ];

    expect(normalizeReaderSummary(summary, numbered(2)).overview.further_reading).toEqual([
      { url: 'https://example.com/2', title: 'The paper', note: 'Its numbers.' },
    ]);
  });
});
