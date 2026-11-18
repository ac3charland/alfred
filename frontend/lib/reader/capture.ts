import type { ReaderPostListItem } from '@/lib/types';

/**
 * The notes an Inbox item captured from a Reader post carries: which post prompted it, then —
 * when the post has one — the link back to it. Task rows don't draw `source_url`, so the notes
 * are where the provenance is visible in the task's detail panel. The eyebrow is the row's own
 * (`postEyebrow`), so an Instapaper article names its site and a research report reads "Research".
 */
export function readerCaptureNotes(
  post: Pick<ReaderPostListItem, 'title'>,
  eyebrow: string,
  href: string | undefined,
): string {
  const origin = `From the Reader: “${post.title}” — ${eyebrow}`;
  return href === undefined ? origin : `${origin}\n${href}`;
}
