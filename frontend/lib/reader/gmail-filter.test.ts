import { makeReaderPublicationListItem } from '@/lib/reader/fixtures';

import { gmailFilterQuery } from './gmail-filter';

describe('gmailFilterQuery', () => {
  it('collapses every substack handle into one wildcard clause, excluding the stats digest', () => {
    const publications = [
      makeReaderPublicationListItem('A', { handle: 'a@substack.com', enabled: true }),
      makeReaderPublicationListItem('B', { handle: 'b@substack.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe('*@substack.com AND -no-reply@substack.com');
  });

  it('ORs the wildcard substack clause with every other handle', () => {
    const publications = [
      makeReaderPublicationListItem('Sub', { handle: 'sub@substack.com', enabled: true }),
      makeReaderPublicationListItem('Strat', { handle: 'email@stratechery.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe(
      '*@substack.com AND -no-reply@substack.com OR email@stratechery.com',
    );
  });

  it('sorts non-substack handles alphabetically by domain, not by the full handle', () => {
    const publications = [
      makeReaderPublicationListItem('Z-local', { handle: 'zed@aaa.com', enabled: true }),
      makeReaderPublicationListItem('A-local', { handle: 'ay@zzz.com', enabled: true }),
    ];

    // 'ay@zzz.com'.localeCompare('zed@aaa.com') would put the a-local handle first; sorting by
    // domain reverses it, since aaa.com sorts ahead of zzz.com.
    expect(gmailFilterQuery(publications)).toBe('zed@aaa.com OR ay@zzz.com');
  });

  it('produces the full mixed shape: the substack clause first, then others sorted by domain', () => {
    const publications = [
      makeReaderPublicationListItem('Sub2', { handle: 'sub2@substack.com', enabled: true }),
      makeReaderPublicationListItem('Zeta', { handle: 'hello@zeta.com', enabled: true }),
      makeReaderPublicationListItem('Alpha', { handle: 'hi@alpha.com', enabled: true }),
      makeReaderPublicationListItem('Sub1', { handle: 'sub1@substack.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe(
      '*@substack.com AND -no-reply@substack.com OR hi@alpha.com OR hello@zeta.com',
    );
  });

  it('excludes paused publications', () => {
    const publications = [
      makeReaderPublicationListItem('Live', { handle: 'live@example.com', enabled: true }),
      makeReaderPublicationListItem('Paused', { handle: 'paused@example.com', enabled: false }),
    ];

    expect(gmailFilterQuery(publications)).toBe('live@example.com');
  });

  it('carries no from: prefix and no wrapping parens for a single handle', () => {
    const publications = [
      makeReaderPublicationListItem('Only', { handle: 'only@example.com', enabled: true }),
    ];

    expect(gmailFilterQuery(publications)).toBe('only@example.com');
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
