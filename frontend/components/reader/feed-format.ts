import { formatElapsed } from '@/components/comms/comms-format';
import { formatPostDate } from '@/components/reader/reader-format';
import { ApiError } from '@/lib/api-client';
import type { ReaderPublicationListItem } from '@/lib/types';

/**
 * The words a feed's roster card and its Add field speak: the card's sub-line, the amber line a
 * failing feed shows, and the line under the field when a URL is refused.
 */

/** Whether a roster row is a feed — always `feed_url is not null`. */
export function isFeed(
  publication: Pick<ReaderPublicationListItem, 'feed_url'>,
): publication is Pick<ReaderPublicationListItem, 'feed_url'> & { feed_url: string } {
  return publication.feed_url !== null;
}

/** The pause toggle's title on a feed's card. */
export const FEED_TOGGLE_TITLE =
  "Paused feeds aren't polled; posts already here stay. Re-enabling takes posts from the last seven days.";

/** The pause toggle's title on a sender's card. */
export const SENDER_TOGGLE_TITLE =
  'Paused publications are not claimed; posts already here stay. Re-enabling claims only mail from the last seven days.';

/** A feed card's sub-line: its URL, its newest post, and when the Worker last checked it. */
export function feedSubline(publication: ReaderPublicationListItem, now: Date): string {
  const lastPost =
    publication.last_post_at === null
      ? 'no posts yet'
      : `last post ${formatPostDate(publication.last_post_at, now)}`;
  const checked =
    publication.feed_checked_at === null
      ? 'not checked yet'
      : `checked ${formatElapsed(publication.feed_checked_at, now)}`;
  return `${publication.feed_url ?? ''} · ${lastPost} · ${checked}`;
}

/**
 * The amber line a failing feed's card shows, or nothing for a healthy one. A feed is failing
 * while its last error is newer than its last success (or it has never succeeded). "Since" counts
 * from the last success — the error is re-stamped every hourly retry — or, for a feed that never
 * read, from that error.
 */
export function feedFailureLine(
  publication: ReaderPublicationListItem,
  now: Date,
): string | undefined {
  const { feed_last_error: error, feed_last_error_at: errorAt } = publication;
  if (error === null || errorAt === null) return undefined;
  const success = publication.feed_last_success_at;
  if (success !== null && Date.parse(success) >= Date.parse(errorAt)) return undefined;
  return `Couldn't read the feed: ${error}. Failing since ${formatElapsed(success ?? errorAt, now)}; retried hourly.`;
}

/** The line under the Add field for a page that answered but isn't a feed. */
export const NOT_A_FEED_MESSAGE =
  "That page isn't an RSS or Atom feed. Paste the feed's own URL, often ending in /feed.xml, /rss or /atom.xml.";

/** The line under the Add field for a feed already on the roster. */
export const DUPLICATE_FEED_MESSAGE = 'That feed is already on the roster.';

/** The line under the Add field for text the route won't take as an http(s) URL. */
export const NOT_A_URL_MESSAGE =
  "That isn't a web address. Paste the full URL, starting with https://.";

/** The line for anything else that went wrong. */
export const ADD_FEED_FAILED_MESSAGE = "Couldn't add that feed.";

/** The `{ error, status }` a refused feed's response carries, read defensively. */
function refusal(body: unknown): { error?: unknown; status?: unknown } {
  return typeof body === 'object' && body !== null ? body : {};
}

/** The line under the Add field for a failed add, in the owner's words. */
export function addFeedErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return ADD_FEED_FAILED_MESSAGE;
  if (error.status === 409) return DUPLICATE_FEED_MESSAGE;
  if (error.status === 400) return NOT_A_URL_MESSAGE;
  if (error.status !== 422) return ADD_FEED_FAILED_MESSAGE;
  const body = refusal(error.body);
  if (body.error === 'not-a-feed') return NOT_A_FEED_MESSAGE;
  if (body.error === 'unreachable') {
    const answer = typeof body.status === 'number' ? String(body.status) : 'no answer';
    return `Couldn't reach that URL (${answer}).`;
  }
  return ADD_FEED_FAILED_MESSAGE;
}
