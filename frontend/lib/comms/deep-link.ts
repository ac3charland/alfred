import type { CommAccount, CommMessage } from '@/lib/types';

/**
 * "Open in source" — the verb that makes alfred safe to be wrong. alfred mirrors and never
 * owns, so the message in its own client is always the truth: if a row's ask reads oddly, or
 * the body never decoded, or the model refused to judge it, the fix is one click into Mail or
 * Messages rather than anything alfred can do to the row.
 *
 * Desktop-only by decision, and per-client: an email opens through Apple Mail's `message:`
 * scheme, keyed on the RFC822 Message-ID captured at ingest; iMessage can only open the
 * CONVERSATION, never a single message, so a group chat gets the app and nothing more.
 */

/** Everything the row's link control needs: its label, its href, and why it has none. */
export interface DeepLink {
  /** Which client this opens — the verb's own label. */
  label: string;
  /** The URL, or `undefined` when the row carries nothing to build one from. */
  href: string | undefined;
  /** Why there is no link, for the disabled control's title. `undefined` when there is one. */
  unavailable: string | undefined;
}

/**
 * Percent-encode one URI token — a Message-ID, or an iMessage handle — keeping the two
 * characters `encodeURIComponent` over-escapes. Both `@` and `+` are legal unescaped in a URI
 * path (RFC 3986 `pchar`), and both are in every real address or phone number, so Mail wants
 * `…@mail.gmail.com` and Messages wants `imessage://+15550102233` rather than the `%40` /
 * `%2B` forms.
 */
function encodeUriToken(token: string): string {
  return encodeURIComponent(token).replaceAll('%2B', '+').replaceAll('%40', '@');
}

/** A Message-ID is stored as it arrived, brackets and all; the scheme wants the bare id. */
function stripAngleBrackets(rawId: string): string {
  return rawId.trim().replace(/^</, '').replace(/>$/, '');
}

/**
 * Is this row a group conversation? Only a one-to-one chat can be addressed by a handle —
 * a named group has no single participant to open, so it opens Messages itself.
 */
function isGroupChat(message: CommMessage): boolean {
  return message.chat_name !== null || message.participants.length > 1;
}

/**
 * The deep link for one row, given the account it arrived on.
 *
 * An email with no captured Message-ID has nothing to address, so the control is disabled and
 * says why rather than opening Mail to the wrong place. iMessage always yields something: at
 * worst the app itself, which is still one click closer than nothing.
 */
export function messageDeepLink(message: CommMessage, account: CommAccount | undefined): DeepLink {
  if (account === undefined) {
    return {
      label: 'Open in source',
      href: undefined,
      unavailable: "alfred can't tell which account this arrived on, so it can't open it.",
    };
  }

  if (account.kind === 'imessage') {
    const handle = message.sender_handle.trim();
    // A group has no single addressee, so the scheme opens Messages and stops there.
    const href =
      isGroupChat(message) || handle === ''
        ? 'imessage://'
        : `imessage://${encodeUriToken(handle)}`;
    return { label: 'Open in Messages', href, unavailable: undefined };
  }

  const rawId = message.rfc822_message_id?.trim();
  if (rawId === undefined || rawId === '') {
    return {
      label: 'Open in Mail',
      href: undefined,
      unavailable: 'No Message-ID was captured for this row, so there is nothing for Mail to open.',
    };
  }

  return {
    label: 'Open in Mail',
    href: `message://%3C${encodeUriToken(stripAngleBrackets(rawId))}%3E`,
    unavailable: undefined,
  };
}
