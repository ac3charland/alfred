/**
 * The ingest wire contract — the daemon's own copy of the shapes the Worker's ingest endpoint
 * accepts. Nothing here is imported from the Worker: the daemon ships separately, onto a machine
 * that may be running an older build, so the contract is duplicated on purpose and versioned with
 * `version` rather than shared through a package boundary.
 *
 * Field names are snake_case because they are wire names, not TypeScript names.
 *
 * Optional fields are modelled as `?: T` rather than `T | null`. `JSON.stringify` drops an
 * `undefined` value, so an absent field goes out as an absent key; the endpoint accepts either an
 * absent key or an explicit null.
 */

/** The two sources the daemon owns. Gmail is polled by the Worker and never comes through here. */
export type SourceKey = 'imessage' | 'workmail';

/** The transport behind a source, as the ingest endpoint labels the account. */
export type SourceKind = 'imessage' | 'imap';

/**
 * How long the server may go without hearing from a source before it calls the account stale.
 * The daemon beats once a minute, so five missed beats is the threshold.
 */
export const EXPECTED_INTERVAL_SECONDS = 300;

/** The payload version this build speaks. */
export const INGEST_PAYLOAD_VERSION = 1;

/** One message, normalized out of whatever the source's native shape was. */
export interface NormalizedMessage {
  /** The source's own stable identity for this message — chat.db's guid, IMAP's Message-ID. */
  source_id: string;
  /** The RFC822 Message-ID, when the source is mail. Deep links are built from it. */
  rfc822_message_id?: string;
  /** Groups messages into a conversation: a chat guid, an IMAP thread/references root. */
  thread_key: string;
  direction: 'inbound' | 'outbound';
  sender_handle: string;
  sender_name?: string;
  /** The conversation's display name, for group chats and named threads. */
  chat_name?: string;
  participants: string[];
  subject?: string;
  /** May be empty when extraction failed — see `body_extracted`. A message is never skipped. */
  body: string;
  /** ISO 8601. */
  received_at: string;
  /** False when the body could not be decoded; the row is still sent, flagged. */
  body_extracted: boolean;
  has_attachments: boolean;
  in_reply_to?: string;
  references_ids: string[];
  /**
   * The bulk-mail headers this message actually carries, lower-cased: `list-unsubscribe`,
   * `list-id`, and `precedence` when its value says bulk. Absent when there are none.
   *
   * The daemon reports them and never acts on them. Deciding a newsletter also means checking the
   * sender against the priority-people roster, which lives server-side, so the filter belongs to
   * the endpoint and the pipe stays dumb.
   */
  list_headers?: string[];
}

/** The account a payload speaks for. One payload carries exactly one account's traffic. */
export interface IngestAccount {
  key: SourceKey;
  kind: SourceKind;
  label: string;
  /** Every handle that means "the owner", so the server can tell inbound from outbound. */
  owner_handles: string[];
  expected_interval_seconds: number;
}

/**
 * Liveness for the account. `ok: false` means the poll failed — the account is erroring, not
 * merely quiet, and the server needs to say so rather than leaving a green dot over a dead source.
 */
export interface IngestHeartbeat {
  ok: boolean;
  /** Where the daemon has read up to. Absent until the source has produced one. */
  cursor?: unknown;
  error?: string;
}

/** A heartbeat with no messages is a first-class payload, not a degenerate one. */
export interface IngestPayload {
  version: typeof INGEST_PAYLOAD_VERSION;
  account: IngestAccount;
  heartbeat: IngestHeartbeat;
  messages: NormalizedMessage[];
}

/** What a 200 returns. The server's cursor wins over the daemon's local copy on the next resume. */
export interface IngestResponse {
  accepted: number;
  duplicates: number;
  drained: number;
  cursor?: unknown;
  last_seen_at?: string;
}
