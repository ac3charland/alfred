import { makeWikiSync } from '@/lib/wiki/fixtures';

import { formatWikiDate, wikiHeaderDescription, wikiSyncFailureLine } from './wiki-format';

const NOW = new Date('2026-10-03T16:00:00.000Z');

describe('wikiHeaderDescription', () => {
  it('says how many pages and how long since the sync', () => {
    const sync = makeWikiSync({ synced_at: '2026-10-03T14:00:00.000Z' });
    expect(wikiHeaderDescription(42, sync, NOW)).toBe('42 pages · synced 2h ago');
  });

  it('says a single page in the singular', () => {
    expect(wikiHeaderDescription(1, makeWikiSync(), NOW)).toBe('1 page · synced 2h ago');
  });

  it('says not synced yet with no sync row', () => {
    expect(wikiHeaderDescription(0, null, NOW)).toBe('0 pages · not synced yet');
  });

  it('says not synced yet for a sync row that has never succeeded', () => {
    expect(wikiHeaderDescription(0, makeWikiSync({ synced_at: null }), NOW)).toBe(
      '0 pages · not synced yet',
    );
  });

  it('appends the pages the last run left pending', () => {
    const sync = makeWikiSync({ synced_at: '2026-10-01T16:00:00.000Z', pending: 12 });
    expect(wikiHeaderDescription(42, sync, NOW)).toBe(
      '42 pages · synced 2d ago · 12 pages still syncing',
    );
    expect(wikiHeaderDescription(42, makeWikiSync({ pending: 1 }), NOW)).toBe(
      '42 pages · synced 2h ago · 1 page still syncing',
    );
  });
});

describe('wikiSyncFailureLine', () => {
  it('reports a failure newer than the last sync, dating both', () => {
    const sync = makeWikiSync({
      synced_at: '2026-10-01T16:00:00.000Z',
      last_error: 'GraphQL: rate limited',
      last_error_at: '2026-10-03T13:00:00.000Z',
    });
    expect(wikiSyncFailureLine(sync, NOW)).toBe(
      'The last sync failed 3h ago — showing the snapshot from 2d ago.',
    );
  });

  it('stays quiet when the last sync succeeded after the failure', () => {
    const sync = makeWikiSync({
      synced_at: '2026-10-03T14:00:00.000Z',
      last_error_at: '2026-10-03T13:00:00.000Z',
    });
    expect(wikiSyncFailureLine(sync, NOW)).toBeUndefined();
  });

  it('stays quiet with no failure, and with no sync row', () => {
    expect(wikiSyncFailureLine(makeWikiSync(), NOW)).toBeUndefined();
    expect(wikiSyncFailureLine(null, NOW)).toBeUndefined();
  });

  it('reports a failure before any sync ever succeeded', () => {
    const sync = makeWikiSync({ synced_at: null, last_error_at: '2026-10-03T13:00:00.000Z' });
    expect(wikiSyncFailureLine(sync, NOW)).toBe(
      'The last sync failed 3h ago — nothing has synced yet.',
    );
  });
});

describe('formatWikiDate', () => {
  it('reads a calendar date without a time zone', () => {
    expect(formatWikiDate('2026-10-03')).toBe('Oct 3, 2026');
    expect(formatWikiDate('2026-01-31')).toBe('Jan 31, 2026');
  });

  it('answers undefined for a missing or malformed date', () => {
    expect(formatWikiDate(null)).toBeUndefined();
    expect(formatWikiDate('2026-13-01')).toBeUndefined();
    expect(formatWikiDate('yesterday')).toBeUndefined();
  });
});
