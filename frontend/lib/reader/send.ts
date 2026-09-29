import { postWebUrl } from '@/lib/reader/open-link';
import { isResearchPost } from '@/lib/reader/research';
import { isInstapaperPost } from '@/lib/reader/source';
import type { ReaderPostListItem } from '@/lib/types';

/**
 * Whether the row's Send verb can run, and the sentence its disabled button carries when it can't.
 *
 * Drawn from the list row alone — the browser never holds a post's body — so "has a body" is the
 * same presence signal the re-summarise verb uses: a positive word count on text the retention
 * sweep has not taken. The route decides on the real bodies and answers 409 if a stale tab got
 * this wrong; the two agree for every row the Worker writes, because it stores HTML only beside
 * non-empty text and the sweep takes both together.
 */

export const NOT_CONFIGURED = "Instapaper isn't set up on this deployment.";

export const NOTHING_TO_SEND = 'No link and no stored text to send.';

/** A research post's Send, until its report has been delivered: there is nothing to save yet. */
export const REPORT_NOT_ARRIVED = "The report hasn't arrived yet.";

/**
 * Why Send can't run for this post on this deployment, or `undefined` when it can. An article
 * from To Reader is always sendable on a configured deployment: its send moves the owner's own
 * bookmark back to Unread, which needs neither a link nor a body in hand. A research post is
 * sendable once its report has arrived — it has no link, so the body is what goes, and a swept
 * report reads as nothing to send like any other post whose text is gone.
 */
export function sendUnavailable(
  post: Pick<
    ReaderPostListItem,
    'canonical_url' | 'source' | 'research_state' | 'text_swept_at' | 'word_count'
  >,
  instapaperConfigured: boolean,
): string | undefined {
  if (!instapaperConfigured) return NOT_CONFIGURED;
  if (isResearchPost(post) && post.research_state !== 'done') return REPORT_NOT_ARRIVED;
  if (isInstapaperPost(post)) return undefined;
  const hasBody = post.text_swept_at === null && post.word_count > 0;
  return postWebUrl(post) === undefined && !hasBody ? NOTHING_TO_SEND : undefined;
}
