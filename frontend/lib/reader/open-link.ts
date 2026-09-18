import type { ReaderPostListItem } from '@/lib/types';

/**
 * Where the row's "Open" verb points: the post's own canonical URL when extraction found
 * one, else a Gmail permalink built from the captured Message-ID, else nothing at all — the
 * disabled state, with a sentence saying why rather than a link to the wrong place.
 */
export type ReaderOpenLink =
  | { href: string; kind: 'canonical' | 'mailbox'; unavailable: undefined }
  | { href: undefined; kind: undefined; unavailable: string };

/** A Message-ID is stored as it arrived, brackets and all; the search operator wants the bare id. */
function stripAngleBrackets(rawId: string): string {
  return rawId.trim().replace(/^</, '').replace(/>$/, '');
}

/**
 * The row's "Open" target. Canonical first, else the Gmail permalink built
 * from the RFC822 Message-ID comms captured at ingest (`rfc822msgid:` is Gmail search's own
 * operator, so this reopens exactly the mirrored message), else disabled — no link was ever
 * found and no Message-ID was captured, so there is nothing for "Open" to point at.
 */
export function postOpenLink(post: ReaderPostListItem): ReaderOpenLink {
  const canonical = post.canonical_url?.trim();
  if (canonical !== undefined && canonical !== '') {
    return { href: canonical, kind: 'canonical', unavailable: undefined };
  }

  const rawId = post.rfc822_message_id?.trim();
  if (rawId !== undefined && rawId !== '') {
    const id = encodeURIComponent(stripAngleBrackets(rawId));
    return {
      href: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${id}`,
      kind: 'mailbox',
      unavailable: undefined,
    };
  }

  return {
    href: undefined,
    kind: undefined,
    unavailable: 'No link in the post and no Message-ID captured for it.',
  };
}
