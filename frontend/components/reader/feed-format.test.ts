import { ApiError } from '@/lib/api-client';
import { makeReaderFeed, makeReaderPublicationListItem } from '@/lib/reader/fixtures';
import type { ReaderPublicationListItem } from '@/lib/types';

import {
  DUPLICATE_FEED_MESSAGE,
  NOT_A_FEED_MESSAGE,
  addFeedErrorMessage,
  feedFailureLine,
  feedSubline,
  isFeed,
} from './feed-format';

const NOW = new Date('2026-11-09T15:00:00.000Z');

function feed(overrides: Partial<ReaderPublicationListItem> = {}): ReaderPublicationListItem {
  return {
    ...makeReaderFeed('mlarson.org', 'https://mlarson.org/feed.xml', overrides),
    last_post_at: overrides.last_post_at ?? null,
  };
}

describe('isFeed', () => {
  it('is true exactly when the row has a feed URL', () => {
    expect(isFeed(feed())).toBe(true);
    expect(isFeed(makeReaderPublicationListItem('Import AI'))).toBe(false);
  });
});

describe('feedSubline', () => {
  it('reads the URL, the newest post and the last check', () => {
    expect(
      feedSubline(
        feed({
          last_post_at: '2026-11-03T10:00:00.000Z',
          feed_checked_at: '2026-11-09T14:48:00.000Z',
        }),
        NOW,
      ),
    ).toBe('https://mlarson.org/feed.xml · last post Nov 3 · checked 12m ago');
  });

  it('says so when there are no posts and no check yet', () => {
    expect(feedSubline(feed(), NOW)).toBe(
      'https://mlarson.org/feed.xml · no posts yet · not checked yet',
    );
  });
});

describe('feedFailureLine', () => {
  it('shows while the error is newer than the last success, counting from the success', () => {
    expect(
      feedFailureLine(
        feed({
          feed_last_success_at: '2026-11-09T12:00:00.000Z',
          feed_last_error: 'it answered 404',
          feed_last_error_at: '2026-11-09T14:00:00.000Z',
        }),
        NOW,
      ),
    ).toBe("Couldn't read the feed: it answered 404. Failing since 3h ago; retried hourly.");
  });

  it('counts from the first error for a feed that has never read', () => {
    expect(
      feedFailureLine(
        feed({
          feed_last_error: "it didn't answer",
          feed_last_error_at: '2026-11-09T14:30:00.000Z',
        }),
        NOW,
      ),
    ).toBe("Couldn't read the feed: it didn't answer. Failing since 30m ago; retried hourly.");
  });

  it('clears once a later poll succeeds', () => {
    expect(
      feedFailureLine(
        feed({
          feed_last_success_at: '2026-11-09T14:30:00.000Z',
          feed_last_error: 'it answered 404',
          feed_last_error_at: '2026-11-09T13:00:00.000Z',
        }),
        NOW,
      ),
    ).toBeUndefined();
  });

  it('is nothing for a feed that has never failed', () => {
    expect(feedFailureLine(feed(), NOW)).toBeUndefined();
  });
});

describe('addFeedErrorMessage', () => {
  it.each([
    [new ApiError('x', 422, 'not-a-feed', { error: 'not-a-feed' }), NOT_A_FEED_MESSAGE],
    [
      new ApiError('x', 422, 'unreachable', { error: 'unreachable', status: 404 }),
      "Couldn't reach that URL (404).",
    ],
    [
      new ApiError('x', 422, 'unreachable', { error: 'unreachable' }),
      "Couldn't reach that URL (no answer).",
    ],
    [new ApiError('x', 409, 'duplicate', { error: 'duplicate' }), DUPLICATE_FEED_MESSAGE],
    [new ApiError('x', 500, 'boom', { error: 'boom' }), "Couldn't add that feed."],
    [new Error('offline'), "Couldn't add that feed."],
  ])('words %p', (error, message) => {
    expect(addFeedErrorMessage(error)).toBe(message);
  });

  it('words a refused URL the way the field shows it', () => {
    expect(NOT_A_FEED_MESSAGE).toBe(
      "That page isn't an RSS or Atom feed. Paste the feed's own URL, often ending in /feed.xml, /rss or /atom.xml.",
    );
    expect(DUPLICATE_FEED_MESSAGE).toBe('That feed is already on the roster.');
  });
});
