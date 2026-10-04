import type { ReaderPostListItem } from '@/lib/types';

import { isWebUrl } from './open-link';

/** The disabled send verb's title on a deployment with no Instapaper credentials. */
export const INSTAPAPER_UNCONFIGURED = "Instapaper isn't set up on this deployment.";

/** The disabled send verb's title on a post with neither a web link nor a body. */
export const NOTHING_TO_SEND = 'No link and no stored text to send.';

/**
 * Why the row's "Send to Instapaper" verb can't run, or `undefined` when it can.
 *
 * A send needs something for Instapaper to save: a web link (Instapaper can fetch the page
 * itself), or a stored body (sent as the bookmark's content, privately when there is no link).
 * The list payload carries no body, so its presence is read the way the re-summarise verb reads
 * it — `word_count` for "there ever was one", `text_swept_at` for "the sweep took it". The route
 * answers the same question from the body itself, for a tab left open across a sweep.
 */
export function sendUnavailable(
  post: Pick<ReaderPostListItem, 'canonical_url' | 'text_swept_at' | 'word_count'>,
  instapaperConfigured: boolean,
): string | undefined {
  if (!instapaperConfigured) return INSTAPAPER_UNCONFIGURED;
  const canonical = post.canonical_url?.trim();
  if (canonical !== undefined && isWebUrl(canonical)) return undefined;
  const hasBody = post.text_swept_at === null && post.word_count > 0;
  return hasBody ? undefined : NOTHING_TO_SEND;
}
