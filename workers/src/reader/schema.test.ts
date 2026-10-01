import type { NumberedLink } from './links';
import {
  READER_MAX_BULLETS,
  READER_MAX_FURTHER_READING,
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
      further_reading: [],
    },
  };
}

/** The numbered links a post's input carried — what a pick's number must be one of. */
const LINKS: readonly NumberedLink[] = Array.from({ length: 14 }, (_, index) => ({
  n: index + 1,
  url: `https://example.com/source-${String(index + 1)}`,
}));

/** A raw pick, as the model writes it. */
function pick(link: number, title = `Source ${String(link)}`, note = 'What the post uses it for.') {
  return { link, title, note };
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

  it('asks for further reading as link numbers with a title and a note, every key required', () => {
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

  it('accepts well-formed further reading', () => {
    const summary = validSummary();
    summary.overview.further_reading = [pick(3), pick(1)];
    expect(isReaderSummary(summary)).toBe(true);
  });

  it.each([
    ['a non-array', 'none'],
    ['a bare string item', ['https://example.com']],
    ['a string link number', [{ link: '3', title: 't', note: 'n' }]],
    ['a fractional link number', [{ link: 1.5, title: 't', note: 'n' }]],
    ['a missing title', [{ link: 1, note: 'n' }]],
    ['a non-string note', [{ link: 1, title: 't', note: 4 }]],
  ])('rejects further reading that is %s', (_name, further) => {
    const summary = validSummary();
    expect(
      isReaderSummary({ ...summary, overview: { ...summary.overview, further_reading: further } }),
    ).toBe(false);
  });

  it('rejects a further-reading item that is a bare JSON null', () => {
    const summary = validSummary();
    const further = parseJson('[null]');
    expect(
      isReaderSummary({ ...summary, overview: { ...summary.overview, further_reading: further } }),
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

    const trimmed = normalizeReaderSummary(summary, LINKS);

    expect(trimmed.overview.novel_ideas).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.evidence).toHaveLength(READER_MAX_BULLETS);
    expect(trimmed.overview.novel_ideas[0]).toBe('idea 0');
    expect(trimmed.overview.novel_ideas.at(-1)).toBe('idea 5');
  });

  it('leaves a short list, the strings and the headline untouched', () => {
    const summary = validSummary();
    expect(normalizeReaderSummary(summary, LINKS)).toEqual(summary);
  });

  it('returns a fresh object rather than mutating the parsed body', () => {
    const summary = validSummary();
    summary.overview.evidence = Array.from({ length: 8 }, () => 'fact');

    normalizeReaderSummary(summary, LINKS);

    expect(summary.overview.evidence).toHaveLength(8);
  });
});

/** The further reading a summary with these picks stores. */
function further(picks: ReturnType<typeof pick>[], links: readonly NumberedLink[] = LINKS) {
  const summary = validSummary();
  summary.overview.further_reading = picks;
  return normalizeReaderSummary(summary, links).overview.further_reading;
}

describe('normalizeReaderSummary — further reading', () => {
  it('maps each pick’s number to the URL the post carries, with its title and note', () => {
    expect(further([pick(2, 'The gap paper', 'The lead item’s source.')])).toEqual([
      {
        url: 'https://example.com/source-2',
        title: 'The gap paper',
        note: 'The lead item’s source.',
      },
    ]);
  });

  it('drops a number that is not in the list, so no stored URL is one the model made up', () => {
    expect(further([pick(0), pick(99), pick(4), pick(-1)])).toEqual([
      expect.objectContaining({ url: 'https://example.com/source-4' }),
    ]);
  });

  it('keeps nothing when the post had no links at all', () => {
    expect(further([pick(1), pick(2)], [])).toEqual([]);
  });

  it('keeps one item per link — the first the model wrote — and sorts them into link order', () => {
    expect(
      further([pick(5, 'Five'), pick(2, 'Two'), pick(5, 'Five again'), pick(3, 'Three')]).map(
        (item) => item.title,
      ),
    ).toEqual(['Two', 'Three', 'Five']);
  });

  it(`keeps at most ${String(READER_MAX_FURTHER_READING)}, the first in link order`, () => {
    const picks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => pick(n));
    const kept = further(picks);

    expect(kept).toHaveLength(READER_MAX_FURTHER_READING);
    expect(kept[0]?.url).toBe('https://example.com/source-1');
    expect(kept.at(-1)?.url).toBe('https://example.com/source-10');
  });

  it('trims titles and notes, and drops an item whose title is blank', () => {
    expect(further([pick(1, ' '.repeat(3)), pick(2, '  Two  ', '  why  ')])).toEqual([
      { url: 'https://example.com/source-2', title: 'Two', note: 'why' },
    ]);
  });

  it('counts the cap after a blank title is dropped, not before', () => {
    const picks = [pick(1, ' '), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => pick(n))];

    expect(further(picks)).toHaveLength(READER_MAX_FURTHER_READING);
  });
});
