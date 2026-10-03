import type { Json } from '@/lib/database.types';
import { makeFurtherReading, makeReaderOverview } from '@/lib/reader/fixtures';

import { furtherReadingOf, isReaderOverview, overviewOf, postFurtherReading } from './overview';

/**
 * `ReaderOverview` (a plain interface) is not structurally `Json` (see `overview.ts`'s own
 * comment), so a fixture built as one has to be cast at the test boundary the same way a row
 * read back from Postgres would arrive typed.
 */
function asJson(value: unknown): Json {
  return value as Json;
}

describe('isReaderOverview', () => {
  it('accepts a well-formed overview', () => {
    expect(isReaderOverview(asJson(makeReaderOverview()))).toBe(true);
  });

  it('accepts an empty novel_ideas array — an honest answer, not a malformed one', () => {
    expect(isReaderOverview(asJson(makeReaderOverview({ novel_ideas: [] })))).toBe(true);
  });

  it('rejects null', () => {
    expect(isReaderOverview(null)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isReaderOverview(['not', 'an', 'overview'])).toBe(false);
  });

  it('rejects a scalar', () => {
    expect(isReaderOverview('a summary')).toBe(false);
  });

  it('rejects a missing key', () => {
    const { argument: _argument, ...rest } = makeReaderOverview();
    expect(isReaderOverview(asJson(rest))).toBe(false);
  });

  it('rejects a bullet list with a non-string element', () => {
    const overview = { ...makeReaderOverview(), evidence: ['fine', 42] };
    expect(isReaderOverview(asJson(overview))).toBe(false);
  });

  it('rejects a string where a paragraph field is required to be one but is a number', () => {
    const overview = { ...makeReaderOverview(), who_should_read: 7 };
    expect(isReaderOverview(asJson(overview))).toBe(false);
  });
});

describe('isReaderOverview — further_reading is optional', () => {
  it('accepts an overview with no further_reading key — every summary written before it existed', () => {
    const overview = makeReaderOverview();
    expect(overview).not.toHaveProperty('further_reading');
    expect(isReaderOverview(asJson(overview))).toBe(true);
  });

  it('accepts an overview whose further_reading is malformed, so the rest still renders', () => {
    expect(
      isReaderOverview(asJson({ ...makeReaderOverview(), further_reading: 'not a list' })),
    ).toBe(true);
  });
});

describe('furtherReadingOf', () => {
  it('returns a well-formed list as it is', () => {
    const items = makeFurtherReading();
    expect(furtherReadingOf(items)).toEqual(items);
  });

  it('returns nothing for an absent list', () => {
    expect(furtherReadingOf(undefined)).toEqual([]);
  });

  it.each([
    ['a string', 'https://example.com'],
    ['an object', { url: 'https://example.com', title: 't', note: 'n' }],
    ['an item with a javascript: URL', [{ url: 'javascript:alert(1)', title: 't', note: 'n' }]],
    ['an item with a relative URL', [{ url: '/p/x', title: 't', note: 'n' }]],
    ['an item with a blank title', [{ url: 'https://example.com', title: '  ', note: 'n' }]],
    ['an item with no note', [{ url: 'https://example.com', title: 't' }]],
    ['a null item', [null]],
  ])('treats %s as malformed and returns nothing', (_label, value) => {
    expect(furtherReadingOf(value)).toEqual([]);
  });

  it('hides the whole list when any one item is malformed', () => {
    expect(
      furtherReadingOf([...makeFurtherReading(), { url: 'ftp://x', title: 't', note: 'n' }]),
    ).toEqual([]);
  });
});

describe('overviewOf — reading a stored overview by the kind it was written under', () => {
  const roundup = { highlights: ['A 7B model matches last year’s frontier.'], further_reading: [] };
  const alerts = {
    findings: [
      { category: 'sale', detail: '40% off used outerwear.' },
      { category: 'action', detail: 'Book a trade-in.', deadline: 'Oct 12' },
    ],
  };

  it('reads a null kind as an essay — every summary written before kinds existed', () => {
    const overview = makeReaderOverview();

    expect(overviewOf({ summary_kind: null, overview: asJson(overview) })).toEqual({
      kind: 'essay',
      overview,
    });
  });

  it('reads an essay by the essay guard', () => {
    expect(overviewOf({ summary_kind: 'essay', overview: asJson(makeReaderOverview()) }).kind).toBe(
      'essay',
    );
  });

  it('reads a roundup, keeping only well-formed links', () => {
    const links = makeFurtherReading();

    expect(
      overviewOf({
        summary_kind: 'roundup',
        overview: asJson({ ...roundup, further_reading: links }),
      }),
    ).toEqual({ kind: 'roundup', overview: { ...roundup, further_reading: links } });
    expect(
      overviewOf({
        summary_kind: 'roundup',
        overview: asJson({ ...roundup, further_reading: [{ url: 'javascript:alert(1)' }] }),
      }),
    ).toEqual({ kind: 'roundup', overview: { ...roundup, further_reading: [] } });
  });

  it('reads Alerts findings, a missing deadline as null', () => {
    expect(overviewOf({ summary_kind: 'alerts', overview: asJson(alerts) })).toEqual({
      kind: 'alerts',
      overview: {
        findings: [
          { category: 'sale', detail: '40% off used outerwear.', deadline: null },
          { category: 'action', detail: 'Book a trade-in.', deadline: 'Oct 12' },
        ],
      },
    });
  });

  it('reads an empty findings list as Alerts with nothing notable, not as malformed', () => {
    expect(overviewOf({ summary_kind: 'alerts', overview: asJson({ findings: [] }) })).toEqual({
      kind: 'alerts',
      overview: { findings: [] },
    });
  });

  it('dispatches on the stored kind, never the shape: another kind’s overview is none', () => {
    expect(overviewOf({ summary_kind: 'roundup', overview: asJson(makeReaderOverview()) })).toEqual(
      { kind: 'none' },
    );
    expect(overviewOf({ summary_kind: 'essay', overview: asJson(roundup) })).toEqual({
      kind: 'none',
    });
    expect(overviewOf({ summary_kind: 'alerts', overview: asJson(roundup) })).toEqual({
      kind: 'none',
    });
  });

  it('reads a malformed overview of any kind as none', () => {
    expect(overviewOf({ summary_kind: 'essay', overview: null })).toEqual({ kind: 'none' });
    expect(
      overviewOf({
        summary_kind: 'roundup',
        overview: asJson({ highlights: [1], further_reading: [] }),
      }),
    ).toEqual({ kind: 'none' });
    expect(
      overviewOf({
        summary_kind: 'alerts',
        overview: asJson({ findings: [{ category: 'promo', detail: 'x' }] }),
      }),
    ).toEqual({ kind: 'none' });
    expect(
      overviewOf({
        summary_kind: 'alerts',
        overview: asJson({ findings: [{ category: 'sale', detail: 'x', deadline: 3 }] }),
      }),
    ).toEqual({ kind: 'none' });
  });
});

describe('postFurtherReading — the sendable links, whatever the kind', () => {
  it('reads an essay’s Further reading and a roundup’s Links alike', () => {
    const links = makeFurtherReading();

    expect(
      postFurtherReading({
        summary_kind: null,
        overview: asJson(makeReaderOverview({ further_reading: links })),
      }),
    ).toEqual(links);
    expect(
      postFurtherReading({
        summary_kind: 'roundup',
        overview: asJson({ highlights: [], further_reading: links }),
      }),
    ).toEqual(links);
  });

  it('has none for an Alerts post or an overview that fails its kind', () => {
    expect(
      postFurtherReading({ summary_kind: 'alerts', overview: asJson({ findings: [] }) }),
    ).toEqual([]);
    expect(
      postFurtherReading({
        summary_kind: 'essay',
        overview: asJson({ highlights: [], further_reading: makeFurtherReading() }),
      }),
    ).toEqual([]);
  });
});
