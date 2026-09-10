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

export function normalizeMessage(input: NormalizeInput): NormalizedMessage {
  const { extracted } = input;
  const fallback = mailboxIdentity(input.uidvalidity, input.uid);
  const messageId = extracted?.messageId;
  const receivedAt = extracted?.date ?? input.internalDate ?? input.now;

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
    received_at: receivedAt.toISOString(),
    body_extracted: extracted !== undefined,
    has_attachments: extracted?.hasAttachments ?? false,
    ...(extracted?.inReplyTo === undefined ? {} : { in_reply_to: extracted.inReplyTo }),
    references_ids: extracted?.references ?? [],
    ...(extracted === undefined || extracted.listHeaders.length === 0
      ? {}
      : { list_headers: extracted.listHeaders }),
  };
}
