import type { Json } from '@/lib/database.types';
import { makeFurtherReading, makeReaderOverview } from '@/lib/reader/fixtures';

import { furtherReadingOf, isReaderOverview } from './overview';

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

describe('isReaderOverview — further_reading', () => {
  it('accepts an overview without it — every post summarised before it existed', () => {
    expect(isReaderOverview(asJson(makeReaderOverview()))).toBe(true);
  });

  it('accepts an overview with it', () => {
    const overview = makeReaderOverview({ further_reading: makeFurtherReading() });
    expect(isReaderOverview(asJson(overview))).toBe(true);
  });

  it('still accepts an overview whose further_reading is malformed, so the rest renders', () => {
    const overview = { ...makeReaderOverview(), further_reading: 'not a list' };
    expect(isReaderOverview(asJson(overview))).toBe(true);
  });
});

/** What an overview carrying this `further_reading` value shows. */
function of(further: unknown) {
  return furtherReadingOf({ ...makeReaderOverview(), further_reading: further } as never);
}

describe('furtherReadingOf', () => {
  const item = { url: 'https://example.com/a', title: 'A source', note: 'Why it matters.' };

  it('hands back a well-formed list as it is', () => {
    expect(of(makeFurtherReading())).toEqual(makeFurtherReading());
  });

  it('is empty for an overview without the field', () => {
    expect(furtherReadingOf(makeReaderOverview())).toEqual([]);
  });

  it('is empty for a value that is not a list', () => {
    expect(of({ 0: item })).toEqual([]);
  });

  it('is empty for an empty list', () => {
    expect(of([])).toEqual([]);
  });

  it.each([
    ['a null item', [item, null]],
    ['a string item', ['https://example.com/a']],
    ['an item missing its url', [{ title: 'A', note: 'n' }]],
    ['a non-http url', [{ ...item, url: 'javascript:alert(1)' }]],
    ['an unparseable url', [{ ...item, url: 'not a url' }]],
    ['a non-string title', [{ ...item, title: 4 }]],
    ['a blank title', [{ ...item, title: '  ' }]],
    ['a non-string note', [{ ...item, note: ['n'] }]],
  ])('is empty — the whole section hidden — for %s', (_name, further) => {
    expect(of([item, ...(Array.isArray(further) ? further : [further])])).toEqual([]);
  });
});
