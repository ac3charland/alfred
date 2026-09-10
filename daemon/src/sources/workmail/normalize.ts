import type { NormalizedMessage } from '../../contract.ts';
import type { ExtractedMessage } from './mime.ts';
import { threadKeyFor } from './thread.ts';

/**
 * One IMAP message as the ingest contract wants it.
 *
 * A message whose MIME could not be parsed still becomes a row — empty body, `body_extracted`
 * false, identified by its mailbox coordinates. Skipping it would be a false negative that leaves
 * no trace anywhere in alfred, which is the one outcome this pipe exists to prevent.
 */

export interface NormalizeInput {
  /** `undefined` when the MIME would not parse. */
  extracted: ExtractedMessage | undefined;
  uid: number;
  uidvalidity: number;
  /** The server's own delivery time, and the only date left when no header parsed. */
  internalDate: Date | undefined;
  direction: 'inbound' | 'outbound';
  now: Date;
}

/** What identifies this message when it carries no Message-ID of its own. */
function mailboxIdentity(uidvalidity: number, uid: number): string {
  return `${String(uidvalidity)}:${String(uid)}`;
}

/** The furthest either direction a JavaScript `Date` will go before it refuses to be one. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/**
 * A candidate is trustworthy only if it parsed at all and does not claim to be from the future —
 * `now` is the poll's own instant, so nothing this source emits should ever be later than that.
 */
function isSane(date: Date, now: Date): boolean {
  const ms = date.getTime();
  return !Number.isNaN(ms) && Math.abs(ms) <= MAX_TIMESTAMP_MS && ms <= now.getTime();
}

/**
 * When the message arrived. The IMAP server's own INTERNALDATE — not sender-controlled — is
 * preferred over the RFC822 `Date:` header, which the sender writes and can set to anything: a
 * `Date: Thu, 01 Jan 2099` header would otherwise store a `received_at` the retention sweep
 * (`where received_at < now() - 60 days`) can never reach. This matches the Gmail source's
 * `receivedAt()` (`workers/src/comms/gmail.ts`), which prefers Gmail's own receipt timestamp over
 * any header for the same reason.
 *
 * The header is used only when INTERNALDATE is unavailable, and either candidate is clamped to
 * "not later than now" — a skewed server clock is as untrusted as a forged header once it claims
 * a future the poll hasn't reached yet. The final fallback, `now`, is always sane.
 */
function receivedAt(
  extracted: ExtractedMessage | undefined,
  internalDate: Date | undefined,
  now: Date,
): Date {
  if (internalDate !== undefined && isSane(internalDate, now)) return internalDate;
  const headerDate = extracted?.date;
  if (headerDate !== undefined && isSane(headerDate, now)) return headerDate;
  return now;
}

export function normalizeMessage(input: NormalizeInput): NormalizedMessage {
  const { extracted } = input;
  const fallback = mailboxIdentity(input.uidvalidity, input.uid);
  const messageId = extracted?.messageId;

  return {
    source_id: messageId ?? fallback,
    ...(messageId === undefined ? {} : { rfc822_message_id: messageId }),
    thread_key: threadKeyFor({
      references: extracted?.references ?? [],
      inReplyTo: extracted?.inReplyTo,
      messageId,
      fallback,
    }),
    direction: input.direction,
    sender_handle: extracted?.fromAddress ?? '',
    ...(extracted?.fromName === undefined ? {} : { sender_name: extracted.fromName }),
    participants: extracted?.participants ?? [],
    ...(extracted?.subject === undefined ? {} : { subject: extracted.subject }),
    body: extracted?.body ?? '',
    received_at: receivedAt(extracted, input.internalDate, input.now).toISOString(),
    body_extracted: extracted !== undefined,
    has_attachments: extracted?.hasAttachments ?? false,
    ...(extracted?.inReplyTo === undefined ? {} : { in_reply_to: extracted.inReplyTo }),
    references_ids: extracted?.references ?? [],
    ...(extracted === undefined || extracted.listHeaders.length === 0
      ? {}
      : { list_headers: extracted.listHeaders }),
  };
}
