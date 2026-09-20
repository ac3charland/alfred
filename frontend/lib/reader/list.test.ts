import { makeReaderPost } from '@/lib/reader/fixtures';

import { byReceivedDescending, isActive, isArchived } from './list';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

describe('isActive', () => {
  it('is true for a post with no archived_at', () => {
    const post = makeReaderPost(PUBLICATION_ID, { archived_at: null });
    expect(isActive(post)).toBe(true);
  });

  it('is false once archived_at is stamped', () => {
    const post = makeReaderPost(PUBLICATION_ID, { archived_at: '2026-09-16T09:00:00.000Z' });
    expect(isActive(post)).toBe(false);
  });
});

describe('isArchived', () => {
  it('is false while the post is still on the reading list', () => {
    const post = makeReaderPost(PUBLICATION_ID, { archived_at: null });
    expect(isArchived(post)).toBe(false);
  });

  it('is true once the post has been put away', () => {
    const post = makeReaderPost(PUBLICATION_ID, { archived_at: '2026-09-16T09:00:00.000Z' });
    expect(isArchived(post)).toBe(true);
  });
});

describe('byReceivedDescending', () => {
  it('orders newest arrival first', () => {
    const oldest = makeReaderPost(PUBLICATION_ID, {
      id: 'p-oldest',
      received_at: '2026-09-14T09:00:00.000Z',
    });
    const newest = makeReaderPost(PUBLICATION_ID, {
      id: 'p-newest',
      received_at: '2026-09-16T09:00:00.000Z',
    });
    const middle = makeReaderPost(PUBLICATION_ID, {
      id: 'p-middle',
      received_at: '2026-09-15T09:00:00.000Z',
    });

    expect(byReceivedDescending([oldest, newest, middle]).map((post) => post.id)).toEqual([
      'p-newest',
      'p-middle',
      'p-oldest',
    ]);
  });

  it('is stable: two posts at the same instant keep their input order', () => {
    const first = makeReaderPost(PUBLICATION_ID, {
      id: 'p-first',
      received_at: '2026-09-16T09:00:00.000Z',
    });
    const second = makeReaderPost(PUBLICATION_ID, {
      id: 'p-second',
      received_at: '2026-09-16T09:00:00.000Z',
    });

    expect(byReceivedDescending([first, second]).map((post) => post.id)).toEqual([
      'p-first',
      'p-second',
    ]);
  });

  it('does not mutate the input array', () => {
    const posts = [
      makeReaderPost(PUBLICATION_ID, { id: 'a', received_at: '2026-09-14T09:00:00.000Z' }),
      makeReaderPost(PUBLICATION_ID, { id: 'b', received_at: '2026-09-16T09:00:00.000Z' }),
    ];
    const original = [...posts];

    byReceivedDescending(posts);

    expect(posts).toEqual(original);
  });
});
