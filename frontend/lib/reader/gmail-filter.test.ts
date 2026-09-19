import { makeReaderPublicationListItem } from '@/lib/reader/fixtures';

import { gmailFilterQuery } from './gmail-filter';

describe('gmailFilterQuery', () => {
  it('joins every enabled handle with OR, sorted ascending', () => {
    const publications = [
      makeReaderPublicationListItem('B', { handle: 'b@example.com', enabled: true }),
      makeReaderPublicationListItem('A', { handle: 'a@example.com', enabled: true }),
      makeReaderPublicationListItem('C', { handle: 'c@example.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe(
      'from:(a@example.com OR b@example.com OR c@example.com)',
    );
  });

  it('excludes paused publications', () => {
    const publications = [
      makeReaderPublicationListItem('Live', { handle: 'live@example.com', enabled: true }),
      makeReaderPublicationListItem('Paused', { handle: 'paused@example.com', enabled: false }),
    ];

    expect(gmailFilterQuery(publications)).toBe('from:(live@example.com)');
  });

  it('wraps a single handle with no OR', () => {
    const publications = [
      makeReaderPublicationListItem('Only', { handle: 'only@example.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe('from:(only@example.com)');
  });

  it('is null when nothing is enabled', () => {
    const publications = [
      makeReaderPublicationListItem('Paused', { handle: 'paused@example.com', enabled: false }),
    ];

    expect(gmailFilterQuery(publications)).toBeNull();
  });

  it('is null for an empty roster', () => {
    expect(gmailFilterQuery([])).toBeNull();
  });
});
