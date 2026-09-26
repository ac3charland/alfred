import { makeWikiPage, makeWikiSync } from './fixtures';

describe('makeWikiPage', () => {
  it('honors an explicit null for created or updated rather than defaulting it', () => {
    const page = makeWikiPage('wiki/concepts/x.md', { updated: null });
    expect(page.updated).toBeNull();
    expect(page.created).toBe('2026-10-01');
  });

  it('defaults created and updated when the override omits them entirely', () => {
    const page = makeWikiPage('wiki/concepts/x.md');
    expect(page.created).toBe('2026-10-01');
    expect(page.updated).toBe('2026-10-03');
  });
});

describe('makeWikiSync', () => {
  it('honors an explicit null for synced_at, commit_oid, last_error and last_error_at', () => {
    const sync = makeWikiSync({
      synced_at: null,
      commit_oid: null,
      last_error: 'boom',
      last_error_at: '2026-10-03T00:00:00.000Z',
    });
    expect(sync.synced_at).toBeNull();
    expect(sync.commit_oid).toBeNull();
    expect(sync.last_error).toBe('boom');
    expect(sync.last_error_at).toBe('2026-10-03T00:00:00.000Z');
  });

  it('defaults every field when the override omits it entirely', () => {
    const sync = makeWikiSync();
    expect(sync.synced_at).not.toBeNull();
    expect(sync.commit_oid).not.toBeNull();
    expect(sync.last_error).toBeNull();
    expect(sync.last_error_at).toBeNull();
  });
});
