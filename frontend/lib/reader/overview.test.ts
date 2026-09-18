import type { Json } from '@/lib/database.types';
import { makeReaderOverview } from '@/lib/reader/fixtures';

import { isReaderOverview } from './overview';

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
