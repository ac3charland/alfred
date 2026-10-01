import type { NumberedLink } from './links';
import {
  READER_MAX_BULLETS,
  READER_MAX_FURTHER_READING,
  READER_SUMMARY_SCHEMA,
  type RawReaderSummary,
  isReaderSummary,
  normalizeReaderSummary,
} from './schema';

/** A well-formed summary, the shape every test below varies one field of. */
function validSummary(): RawReaderSummary {
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

/** Links numbered 1..n, each a distinct URL, for the normalisation tests. */
function numbered(count: number): NumberedLink[] {
  return Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    url: `https://a.example/${String(index + 1)}`,
  }));
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

  it('asks for further reading as objects with an integer link, never a URL', () => {
    const { further_reading } = READER_SUMMARY_SCHEMA.properties.overview.properties;
    expect(further_reading.type).toBe('array');
    expect(further_reading.items.additionalProperties).toBe(false);
    expect(further_reading.items.required).toEqual(['link', 'title', 'note']);
    expect(further_reading.items.properties.link.type).toBe('integer');
    expect(further_reading.items.properties.title.type).toBe('string');
    expect(further_reading.items.properties.note.type).toBe('string');
    expect(further_reading.description).toContain('empty is the right answer');
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

/** A summary whose further_reading is replaced by an arbitrary, possibly malformed, value. */
function withFurtherReading(value: unknown): unknown {
  const summary = validSummary();
  return { ...summary, overview: { ...summary.overview, further_reading: value } };
}

/** Normalise one set of picks against a set of links, and return only the stored list. */
function normalizePicks(
  picks: RawReaderSummary['overview']['further_reading'],
  links: readonly NumberedLink[] = numbered(20),
) {
  const summary = validSummary();
  summary.overview.further_reading = picks;
  return normalizeReaderSummary(summary, links).overview.further_reading;
}

describe('isReaderSummary — further reading', () => {
  it('accepts picks with an integer link and string title and note', () => {
    expect(isReaderSummary(withFurtherReading([{ link: 3, title: 'T', note: 'N' }]))).toBe(true);
  });

  it('rejects a missing further_reading', () => {
    const summary = validSummary();
    expect(
      isReaderSummary({ ...summary, overview: without(summary.overview, 'further_reading') }),
    ).toBe(false);
  });

  it('rejects a non-array further_reading', () => {
    expect(isReaderSummary(withFurtherReading('none'))).toBe(false);
    expect(isReaderSummary(withFurtherReading({ link: 1, title: 'T', note: 'N' }))).toBe(false);
  });

  it('rejects an item whose link is a string, a fraction, or absent', () => {
    expect(isReaderSummary(withFurtherReading([{ link: '3', title: 'T', note: 'N' }]))).toBe(false);
    expect(isReaderSummary(withFurtherReading([{ link: 1.5, title: 'T', note: 'N' }]))).toBe(false);
    expect(isReaderSummary(withFurtherReading([{ title: 'T', note: 'N' }]))).toBe(false);
  });

  it('rejects an item whose title or note is not a string, or that is not an object', () => {
    expect(isReaderSummary(withFurtherReading([{ link: 1, title: 4, note: 'N' }]))).toBe(false);
    expect(isReaderSummary(withFurtherReading([{ link: 1, title: 'T', note: ['N'] }]))).toBe(false);
    expect(isReaderSummary(withFurtherReading(['https://a.example/1']))).toBe(false);
    expect(isReaderSummary(withFurtherReading([parseJson('null')]))).toBe(false);
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

  it('keeps an empty further reading empty', () => {
    expect(normalizeReaderSummary(validSummary(), numbered(3)).overview.further_reading).toEqual(
      [],
    );
  });

  describe('further reading', () => {
    it('maps a link number to its URL', () => {
      expect(normalizePicks([{ link: 2, title: 'Two', note: 'Rebutted.' }])).toEqual([
        { url: 'https://a.example/2', title: 'Two', note: 'Rebutted.' },
      ]);
    });

    it('drops a pick whose number was never given to the model', () => {
      expect(
        normalizePicks([
          { link: 99, title: 'Invented', note: 'n' },
          { link: 0, title: 'Zero', note: 'n' },
          { link: 1, title: 'Real', note: 'n' },
        ]),
      ).toEqual([{ url: 'https://a.example/1', title: 'Real', note: 'n' }]);
    });

    it('keeps the first pick of a repeated number', () => {
      expect(
        normalizePicks([
          { link: 4, title: 'First', note: 'a' },
          { link: 4, title: 'Second', note: 'b' },
        ]),
      ).toEqual([{ url: 'https://a.example/4', title: 'First', note: 'a' }]);
    });

    it('orders the survivors by link number', () => {
      expect(
        normalizePicks([
          { link: 9, title: 'Nine', note: 'n' },
          { link: 2, title: 'Two', note: 'n' },
          { link: 5, title: 'Five', note: 'n' },
        ]).map((item) => item.title),
      ).toEqual(['Two', 'Five', 'Nine']);
    });

    it('caps at ten', () => {
      const picks = Array.from({ length: 14 }, (_, index) => ({
        link: 14 - index,
        title: `Item ${String(14 - index)}`,
        note: 'n',
      }));
      const kept = normalizePicks(picks);
      expect(READER_MAX_FURTHER_READING).toBe(10);
      expect(kept).toHaveLength(10);
      expect(kept[0]?.title).toBe('Item 1');
      expect(kept.at(-1)?.title).toBe('Item 10');
    });

    it('trims title and note, and drops an item whose title is blank', () => {
      expect(
        normalizePicks([
          { link: 1, title: '  Padded title \n', note: '  a note ' },
          { link: 2, title: ' '.repeat(3), note: 'no title' },
        ]),
      ).toEqual([{ url: 'https://a.example/1', title: 'Padded title', note: 'a note' }]);
    });

    it('drops everything when the post offered no links', () => {
      expect(normalizePicks([{ link: 1, title: 'T', note: 'n' }], [])).toEqual([]);
    });
  });

  it('returns a fresh object rather than mutating the parsed body', () => {
    const summary = validSummary();
    summary.overview.evidence = Array.from({ length: 8 }, () => 'fact');

    normalizeReaderSummary(summary, []);

    expect(summary.overview.evidence).toHaveLength(8);
  });
});
