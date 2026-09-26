import { postWebUrl } from '@/lib/reader/open-link';
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

/** Why Send can't run for this post on this deployment, or `undefined` when it can. */
export function sendUnavailable(
  post: Pick<ReaderPostListItem, 'canonical_url' | 'text_swept_at' | 'word_count'>,
  instapaperConfigured: boolean,
): string | undefined {
  if (!instapaperConfigured) return NOT_CONFIGURED;
  const hasBody = post.text_swept_at === null && post.word_count > 0;
  return postWebUrl(post) === undefined && !hasBody ? NOTHING_TO_SEND : undefined;
}
