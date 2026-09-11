import { ImapFlow } from 'imapflow';

/**
 * The IMAP surface the WorkMail source uses, and the one adapter that speaks it for real.
 *
 * The interface exists so every other test can drive the source against an in-memory mailbox.
 * It is deliberately tiny, and deliberately READ-ONLY: there is no way through it to set a flag,
 * move, copy or delete a message. alfred watches a mailbox and never writes to one — the queue
 * drains by noticing a reply, not by marking anything on the server.
 */

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ImapMailboxListing {
  /** The full path to select, e.g. `Sent Items`. */
  path: string;
  /** The last segment of the path, which is what the sent-folder name fallback matches on. */
  name: string;
  /** `\Sent`, `\Inbox`, … when the server advertises SPECIAL-USE (or imapflow inferred it). */
  specialUse?: string;
}

export interface ImapMailboxStatus {
  /**
   * The generation number for this mailbox's UIDs. When it changes, every UID the daemon
   * remembered means a different message and the cursor has to be thrown away.
   */
  uidvalidity: number;
  /** The UID the next arriving message will get, so `uidnext - 1` is "everything so far". */
  uidnext: number;
}

export interface ImapMessage {
  uid: number;
  /** The raw RFC822 bytes. Absent if the server answered the fetch without a body. */
  source?: Buffer;
  /** When the server received it — the fallback date for a message whose headers didn't parse. */
  internalDate?: Date;
}

export interface ImapSession {
  list(): Promise<ImapMailboxListing[]>;
  /** Selects a mailbox for reading. Always EXAMINE, never SELECT: nothing is marked seen. */
  open(path: string): Promise<ImapMailboxStatus>;
  /** UIDs of messages the server received at or after `since` — the re-seed path. */
  searchSince(since: Date): Promise<number[]>;
  /** UIDs from `uid` onwards. `UID n:*` is a range, so the answer can include a UID below `n`. */
  searchFrom(uid: number): Promise<number[]>;
  fetchUids(uids: readonly number[]): Promise<ImapMessage[]>;
  logout(): Promise<void>;
}

export type ImapConnect = (options: ImapConnectOptions) => Promise<ImapSession>;

function toDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? value : new Date(value);
}

/**
 * The real client. It holds the password only for as long as the connection lives, and hands it
 * to imapflow with logging switched off so no line of output can ever carry it.
 */
export const connectImap: ImapConnect = async (options) => {
  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: true,
    auth: { user: options.user, pass: options.password },
    logger: false,
  });
  await client.connect();

  return {
    list: async () => {
      const listed = await client.list();
      return listed.map((entry) => ({
        path: entry.path,
        name: entry.name,
        ...(entry.specialUse === undefined ? {} : { specialUse: entry.specialUse }),
      }));
    },
    open: async (path) => {
      const mailbox = await client.mailboxOpen(path, { readOnly: true });
      return { uidvalidity: Number(mailbox.uidValidity), uidnext: mailbox.uidNext };
    },
    searchSince: async (since) => {
      const found = await client.search({ since }, { uid: true });
      return found === false || found === undefined ? [] : found;
    },
    searchFrom: async (uid) => {
      const found = await client.search({ uid: `${String(uid)}:*` }, { uid: true });
      return found === false || found === undefined ? [] : found;
    },
    fetchUids: async (uids) => {
      if (uids.length === 0) return [];
      const messages: ImapMessage[] = [];
      // `source: true` fetches BODY.PEEK[], which leaves the \Seen flag exactly as it was.
      const query = { uid: true, envelope: true, internalDate: true, source: true };
      for await (const message of client.fetch(uids.join(','), query, { uid: true })) {
        const internalDate = toDate(message.internalDate);
        messages.push({
          uid: message.uid,
          ...(message.source === undefined ? {} : { source: message.source }),
          ...(internalDate === undefined ? {} : { internalDate }),
        });
      }
      return messages;
    },
    logout: () => client.logout(),
  };
};

interface ImapErrorish {
  authenticationFailed?: boolean;
  code?: string;
}

function errorFields(error: unknown): ImapErrorish {
  if (!(error instanceof Object)) return {};
  const authenticationFailed =
    'authenticationFailed' in error && error.authenticationFailed === true;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    ...(authenticationFailed ? { authenticationFailed: true } : {}),
    ...(code === undefined ? {} : { code }),
  };
}

const NETWORK_REASONS: Record<string, string> = {
  ENOTFOUND: 'the host name did not resolve',
  EAI_AGAIN: 'the host name did not resolve',
  ECONNREFUSED: 'the connection was refused',
  ECONNRESET: 'the connection was reset',
  ETIMEDOUT: 'the connection timed out',
  ETIMEOUT: 'the connection timed out',
  EHOSTUNREACH: 'the host is unreachable',
  ENETUNREACH: 'the network is unreachable',
  NoConnection: 'the connection was closed',
};

/**
 * An IMAP failure in plain English, and the one place that decides whether a failure is the
 * password's fault or the network's — the distinction that decides what the owner does next.
 * Nothing the server said is repeated verbatim on the auth path, because a rejected LOGIN
 * response can quote the command that carried the password.
 */
export function describeImapFailure(error: unknown, host: string, port: number): string {
  const fields = errorFields(error);
  if (fields.authenticationFailed === true) {
    return (
      `IMAP login was rejected by ${host} — the mailbox password in the keychain is wrong, ` +
      'or the account is locked'
    );
  }

  const reason = fields.code === undefined ? undefined : NETWORK_REASONS[fields.code];
  if (reason !== undefined) return `could not reach ${host}:${String(port)} — ${reason}`;
  if (fields.code !== undefined) return `could not reach ${host}:${String(port)} — ${fields.code}`;

  const detail = error instanceof Error ? error.message : String(error);
  return `IMAP request failed — ${detail}`;
}
