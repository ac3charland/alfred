import type { Json } from '@/lib/database.types';
import { makeReaderOverview } from '@/lib/reader/fixtures';

import { furtherReadingOf, isFurtherReadingList, isReaderOverview } from './overview';

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

describe('further_reading', () => {
  const item = { url: 'https://example.com/a', title: 'A piece', note: 'Builds on it.' };

  it('lets an overview with no further_reading key pass the guard and yields no items', () => {
    const overview = makeReaderOverview();
    expect('further_reading' in overview).toBe(false);
    expect(isReaderOverview(asJson(overview))).toBe(true);
    expect(furtherReadingOf(overview)).toEqual([]);
  });

  it('accepts a well-formed list and returns it in order', () => {
    const second = { url: 'https://example.com/b', title: 'Another', note: '' };
    const overview = { ...makeReaderOverview(), further_reading: [item, second] };
    expect(isReaderOverview(asJson(overview))).toBe(true);
    expect(furtherReadingOf(overview)).toEqual([item, second]);
  });

  it('accepts an empty list', () => {
    const overview = { ...makeReaderOverview(), further_reading: [] };
    expect(isReaderOverview(asJson(overview))).toBe(true);
    expect(furtherReadingOf(overview)).toEqual([]);
  });

  it.each([
    ['a string instead of an array', 'https://example.com/a'],
    ['an object instead of an array', { url: item.url, title: item.title, note: item.note }],
    ['an item missing its note', [{ url: item.url, title: item.title }]],
    ['an item with a non-string url', [{ ...item, url: 42 }]],
    ['a non-object item', [item, 'https://example.com/b']],
    ['a null item', [null]],
  ])('keeps the overview valid but hides the section for %s', (_name, malformed) => {
    const overview = { ...makeReaderOverview(), further_reading: malformed };
    expect(isReaderOverview(asJson(overview))).toBe(true);
    expect(furtherReadingOf(overview as never)).toEqual([]);
  });

  it('filters out an item whose url or title is blank after trimming, keeping the rest', () => {
    const overview = {
      ...makeReaderOverview(),
      further_reading: [
        item,
        { ...item, url: ' '.repeat(3) },
        { ...item, title: '' },
        { ...item, title: ' \n ' },
        { ...item, url: 'https://example.com/c', note: '' },
      ],
    };
    expect(furtherReadingOf(overview)).toEqual([
      item,
      { ...item, url: 'https://example.com/c', note: '' },
    ]);
  });

  it('isFurtherReadingList judges shape only', () => {
    expect(isFurtherReadingList([item])).toBe(true);
    expect(isFurtherReadingList([{ ...item, title: '' }])).toBe(true);
    expect(isFurtherReadingList(undefined)).toBe(false);
    expect(isFurtherReadingList([{ url: 'x' }])).toBe(false);
  });
});
