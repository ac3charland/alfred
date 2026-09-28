import type { ReaderPostListItem, ReaderPublication } from '@/lib/types';

/**
 * Where a post came from, as the row shows it. A newsletter is the Gmail mirror's; an article is
 * one the owner moved into the "To Reader" folder in Instapaper, which the Worker's tick took in
 * and summarised like a newsletter.
 *
 * An article's eyebrow is where the reader judges a source, so it names one: the publication the
 * article is linked to, else the site it is from, else Instapaper. Nothing links an article to a
 * publication yet — a later story does, by the stored site alone — and the eyebrow picks the name
 * up the moment one is set, from the roster the shell already holds, with no change to the list
 * payload. A newsletter's eyebrow is its author, as it always was.
 */

/** The meta line's last word on an article: how it got into the Reader. */
export const VIA_INSTAPAPER = 'via Instapaper';

/** An article's eyebrow when it has no linked publication and no site. */
export const INSTAPAPER_EYEBROW = 'Instapaper';

/** A newsletter's eyebrow when the extractor found no author. */
const UNKNOWN_PUBLICATION = 'Unknown publication';

/** Whether a post is an article from To Reader rather than a newsletter. */
export function isInstapaperPost(post: Pick<ReaderPostListItem, 'source'>): boolean {
  return post.source === 'instapaper';
}

/** The row's eyebrow — see the module comment for the order an article's is chosen in. */
export function postEyebrow(
  post: Pick<ReaderPostListItem, 'source' | 'author' | 'publication_id' | 'site'>,
  publications: readonly Pick<ReaderPublication, 'id' | 'name'>[],
): string {
  if (!isInstapaperPost(post)) return post.author ?? UNKNOWN_PUBLICATION;
  const linked =
    post.publication_id === null
      ? undefined
      : publications.find((publication) => publication.id === post.publication_id);
  return linked?.name ?? post.site ?? INSTAPAPER_EYEBROW;
}
