import type { ReaderPostListItem } from '@/lib/types';

/**
 * Where the row's "Original" link points: the post's own canonical URL when extraction found
 * one, else a Gmail permalink built from the captured Message-ID, else nothing at all — the
 * disabled state, with a sentence saying why rather than a link to the wrong place.
 */
export type ReaderOpenLink =
  | { href: string; kind: 'canonical' | 'mailbox'; unavailable: undefined }
  | { href: undefined; kind: undefined; unavailable: string };

/**
 * Is this a web address, and not something an email merely spelled like one?
 *
 * The canonical URL is extracted from mail nobody in this system wrote, and it lands in an
 * `href` — so `javascript:` and `data:` are refused at the one place that decides what the verb
 * points at, rather than trusted because a `<link rel=canonical>` said so.
 */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The post's own web address, when it has one: the trimmed canonical URL, if it is `http`/`https`.
 * The one rule for "this post has a link" — the Original link, the Instapaper send's `url` and the
 * Send verb's "nothing to send" check all ask it, so none of them can disagree about a `mailto:`.
 */
export function postWebUrl(post: Pick<ReaderPostListItem, 'canonical_url'>): string | undefined {
  const canonical = post.canonical_url?.trim();
  return canonical !== undefined && isWebUrl(canonical) ? canonical : undefined;
}

/** A Message-ID is stored as it arrived, brackets and all; the search operator wants the bare id. */
function stripAngleBrackets(rawId: string): string {
  return rawId.trim().replace(/^</, '').replace(/>$/, '');
}

/**
 * The row's "Original" target. An `http`/`https` canonical URL first, else the Gmail permalink built
 * from the RFC822 Message-ID comms captured at ingest (`rfc822msgid:` is Gmail search's own
 * operator, so this reopens exactly the mirrored message), else disabled — no link was ever
 * found and no Message-ID was captured, so there is nothing for "Original" to point at.
 */
export function postOpenLink(post: ReaderPostListItem): ReaderOpenLink {
  const canonical = postWebUrl(post);
  if (canonical !== undefined) {
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
