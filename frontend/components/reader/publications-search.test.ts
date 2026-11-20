import {
  makeReaderCandidate,
  makeReaderFeed,
  makeReaderPublicationListItem,
} from '@/lib/reader/fixtures';

import { matchesCandidateQuery, matchesPublicationQuery } from './publications-search';

describe('matchesPublicationQuery', () => {
  const sender = makeReaderPublicationListItem('Second Thoughts', {
    handle: 'secondthoughts@substack.com',
    domain: 'substack.com',
    notes: 'great on economics',
  });
  const feed = {
    ...makeReaderFeed('mlarson.org', 'https://mlarson.org/feed.xml'),
    last_post_at: null,
  };

  it('matches everything when the query is empty or whitespace', () => {
    expect(matchesPublicationQuery(sender, '')).toBe(true);
    expect(matchesPublicationQuery(sender, ' '.repeat(3))).toBe(true);
  });

  it('matches the name case-insensitively', () => {
    expect(matchesPublicationQuery(sender, 'second THOUGHTS')).toBe(true);
  });

  it('matches the handle', () => {
    expect(matchesPublicationQuery(sender, 'secondthoughts@')).toBe(true);
  });

  it('matches the domain', () => {
    const domainOnly = makeReaderPublicationListItem('Nameless', {
      handle: null,
      domain: 'example.org',
    });
    expect(matchesPublicationQuery(domainOnly, 'example.org')).toBe(true);
  });

  it('matches the note', () => {
    expect(matchesPublicationQuery(sender, 'economics')).toBe(true);
  });

  it('matches a feed by its URL', () => {
    expect(matchesPublicationQuery(feed, 'feed.xml')).toBe(true);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesPublicationQuery(sender, '  second  ')).toBe(true);
  });

  it('rejects a publication no field of which contains the query', () => {
    expect(matchesPublicationQuery(sender, 'zebra')).toBe(false);
    expect(matchesPublicationQuery(feed, 'substack')).toBe(false);
  });
});

describe('matchesCandidateQuery', () => {
  const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: "Ben's Bites" });

  it('matches everything when the query is blank', () => {
    expect(matchesCandidateQuery(candidate, '  ')).toBe(true);
  });

  it('matches the name case-insensitively', () => {
    expect(matchesCandidateQuery(candidate, "BEN'S")).toBe(true);
  });

  it('matches the handle', () => {
    expect(matchesCandidateQuery(candidate, 'beehiiv')).toBe(true);
  });

  it('matches a nameless candidate by its handle', () => {
    const nameless = makeReaderCandidate('deals@amazon.com');
    expect(matchesCandidateQuery(nameless, 'amazon')).toBe(true);
  });

  it('rejects a candidate neither field of which contains the query', () => {
    expect(matchesCandidateQuery(candidate, 'zebra')).toBe(false);
  });
});
