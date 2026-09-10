import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import type { WorkmailSourceConfig } from '../../config.ts';
import type { NormalizedMessage } from '../../contract.ts';
import { WORKMAIL_PASSWORD_SECRET, createKeychain } from '../../keychain.ts';
import { createLogger } from '../../log.ts';
import type { Logger } from '../../log.ts';
import type { PollResult, Source, SourceContext } from '../types.ts';
import { connectImap, describeImapFailure } from './imap-client.ts';
import type { ImapConnect, ImapMailboxListing, ImapSession } from './imap-client.ts';
import { extractMessage, parseMime } from './mime.ts';
import type { MimeParser } from './mime.ts';
import { normalizeMessage } from './normalize.ts';

/**
 * Amazon WorkMail over IMAP.
 *
 * It reads two mailboxes and never writes to either. INBOX is what arrives; the Sent folder is
 * what makes the queue drain — when the owner answers in their own mail client, that reply lands
 * in Sent naming the queued Message-ID in its In-Reply-To / References, and the server clears the
 * row. alfred never labels, archives or flags anything: watching is the whole mechanism.
 *
 * Everything the source needs from the network is behind `ImapSession`, so the polling rules
 * below — the re-seed, the cursor, the cap — are tested against an in-memory mailbox.
 */

/**
 * One poll's ceiling per mailbox. A first run inside the seven-day window is small; a mailbox
 * restored from backup is not, and a poll that tried to read all of it would hold the whole thing
 * in memory and time out the tick. The cursor stops at the last message emitted, so the next poll
 * simply continues — a backlog drains over several minutes instead of failing all at once.
 */
export const MAX_MESSAGES_PER_MAILBOX = 200;

/** Where the daemon has read up to, per mailbox. */
export interface MailboxCursor {
  uidvalidity: number;
  uid: number;
}

/**
 * UIDs are only meaningful inside one UIDVALIDITY generation, so both mailboxes carry their own
 * pair and a change to either invalidates only that half.
 */
export interface WorkmailCursor {
  inbox?: MailboxCursor;
  sent?: MailboxCursor;
}

export interface WorkmailSourceDeps {
  connect?: ImapConnect;
  /** Resolves a secret by name. Defaults to the keychain, which is where the password lives. */
  secrets?: (name: string) => Promise<string>;
  parse?: MimeParser;
  /** Where a swallowed teardown failure gets reported. Defaults to the real logger (stderr). */
  log?: Logger;
}

/** The names a sent folder goes by when the server advertises no `\Sent` special-use flag. */
const SENT_FOLDER_NAMES = new Set(['sent', 'sent items', 'sent messages']);

/**
 * A password the keychain would not give up is not an IMAP failure, and saying so would send the
 * owner to the wrong place. It is carried out of the session as itself.
 */
class SecretUnavailable extends Error {
  override name = 'SecretUnavailable';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const NO_SENT_FOLDER =
  'no sent folder found — a reply sent from the mail client cannot clear the message it answers';

function isMailboxCursor(value: unknown): value is MailboxCursor {
  if (!(value instanceof Object)) return false;
  return (
    'uidvalidity' in value &&
    typeof value.uidvalidity === 'number' &&
    'uid' in value &&
    typeof value.uid === 'number'
  );
}

/** The cursor comes back from the ingest endpoint as plain JSON, so nothing about it is assumed. */
function readCursor(value: unknown): WorkmailCursor {
  if (!(value instanceof Object)) return {};
  const inbox = 'inbox' in value ? value.inbox : undefined;
  const sent = 'sent' in value ? value.sent : undefined;
  return {
    ...(isMailboxCursor(inbox) ? { inbox } : {}),
    ...(isMailboxCursor(sent) ? { sent } : {}),
  };
}

function findPath(
  mailboxes: readonly ImapMailboxListing[],
  specialUse: string,
  names: ReadonlySet<string>,
): string | undefined {
  return (
    mailboxes.find((mailbox) => mailbox.specialUse === specialUse)?.path ??
    mailboxes.find((mailbox) => names.has(mailbox.name.toLowerCase()))?.path
  );
}

/** The keychain-backed resolver, for the startup check — which runs before any poll context exists. */
function keychainSecrets(user: string): (name: string) => Promise<string> {
  const execFile = promisify(execFileCallback);
  const keychain = createKeychain((file, arguments_) => execFile(file, [...arguments_]));
  return (name: string): Promise<string> =>
    name === WORKMAIL_PASSWORD_SECRET
      ? keychain.readWorkmailPassword(user)
      : Promise.reject(new Error(`unknown secret "${name}"`));
}

interface MailboxRead {
  messages: NormalizedMessage[];
  cursor: MailboxCursor;
}

export function createWorkmailSource(
  config: WorkmailSourceConfig,
  deps: WorkmailSourceDeps = {},
): Source {
  const connect = deps.connect ?? connectImap;
  const parse = deps.parse ?? parseMime;
  const secrets = deps.secrets ?? keychainSecrets(config.user);
  const log = deps.log ?? createLogger();
  const fail = (error: unknown): string =>
    error instanceof SecretUnavailable
      ? error.message
      : describeImapFailure(error, config.host, config.port);

  /** Opens a session for the length of one operation. The password lives no longer than that. */
  async function withSession<T>(run: (session: ImapSession) => Promise<T>): Promise<T> {
    const password = await secrets(WORKMAIL_PASSWORD_SECRET).catch((error: unknown) => {
      throw new SecretUnavailable(describe(error));
    });
    const session = await connect({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
    });
    try {
      return await run(session);
    } finally {
      // A connection `run()` failed on is often already dead, and imapflow's own `logout()`
      // rejects on a dead connection (`NoConnection`). An unguarded await here would let that
      // teardown failure REPLACE whatever `run()` threw, per plain JS `finally` semantics — so
      // the health surface reports "connection already closed" while the real cause (a malformed
      // SEARCH response, say) is lost. Log it and swallow it instead: teardown failing is still
      // visible, but never at the cost of the error that actually explains what went wrong.
      await session.logout().catch((error: unknown) => {
        log.warn('IMAP logout failed — the connection was likely already gone', {
          source: 'workmail',
          error: describe(error),
        });
      });
    }
  }

  async function readMailbox(
    session: ImapSession,
    path: string,
    direction: 'inbound' | 'outbound',
    stored: MailboxCursor | undefined,
    ctx: SourceContext,
  ): Promise<MailboxRead> {
    const status = await session.open(path);
    // A changed UIDVALIDITY means every remembered UID now names a different message, so the
    // cursor is worthless and the anchor — the last successful poll, or the first-run window —
    // is the only honest place to resume from.
    const resume = stored?.uidvalidity === status.uidvalidity ? stored : undefined;

    let found: number[];
    if (resume === undefined) {
      found = await session.searchSince(ctx.anchor);
    } else {
      // `UID n:*` is a range, and a server with nothing above n answers with its newest message
      // regardless. Dropping anything at or below the cursor keeps that from re-delivering it.
      const forward = await session.searchFrom(resume.uid + 1);
      found = forward.filter((uid) => uid > resume.uid);
    }

    const ascending = [...found];
    ascending.sort((a, b) => a - b);
    const requested = ascending.slice(0, MAX_MESSAGES_PER_MAILBOX);
    const fetched = await session.fetchUids(requested);

    const messages = await Promise.all(
      fetched.map(async (message) =>
        normalizeMessage({
          // No source means nothing to read: the row still goes out, flagged, like any other
          // message whose body could not be extracted.
          extracted:
            message.source === undefined ? undefined : await extractMessage(message.source, parse),
          uid: message.uid,
          uidvalidity: status.uidvalidity,
          internalDate: message.internalDate,
          direction,
          now: ctx.now,
        }),
      ),
    );

    // Never past what was emitted: a capped poll continues from the last message it sent. With
    // nothing to send, a resumed mailbox holds still and a re-seeded one starts at what exists
    // now — anything older than the anchor is deliberately never ingested.
    //
    // The walk is over `requested` — the uids SEARCH said exist — not over `fetched`: a FETCH
    // response can come back missing a uid mid-batch (a concurrent expunge, a flaky server) while
    // still returning a LATER one in the same batch. Taking the max of what was merely returned
    // would let the cursor jump past the gap, and the next poll's `searchFrom(cursor + 1)` would
    // never ask for the missing uid again — a silent, permanent loss. Stopping at the first gap
    // instead means the next poll re-requests everything from there on, so a missing uid is
    // retried rather than skipped; a uid fetched past the gap (like 12 above) simply gets asked
    // for again, which is a harmless no-op at the ingest endpoint.
    const fetchedUids = new Set(fetched.map((message) => message.uid));
    let highest = 0;
    for (const uid of requested) {
      if (!fetchedUids.has(uid)) break;
      highest = uid;
    }
    const unchanged = resume?.uid ?? Math.max(status.uidnext - 1, 0);

    return {
      messages,
      cursor: { uidvalidity: status.uidvalidity, uid: highest > 0 ? highest : unchanged },
    };
  }

  async function poll(ctx: SourceContext): Promise<PollResult> {
    const stored = readCursor(ctx.cursor);

    try {
      return await withSession(async (session) => {
        const mailboxes = await session.list();
        const inboxPath = findPath(mailboxes, String.raw`\Inbox`, new Set(['inbox'])) ?? 'INBOX';
        const sentPath = findPath(mailboxes, String.raw`\Sent`, SENT_FOLDER_NAMES);

        const inbox = await readMailbox(session, inboxPath, 'inbound', stored.inbox, ctx);
        // A mailbox with no sent folder still gets its inbox read: the drain is half the value of
        // this source, and stopping over it would cost the other half too. `check()` says so loudly.
        const sent =
          sentPath === undefined
            ? undefined
            : await readMailbox(session, sentPath, 'outbound', stored.sent, ctx);

        const cursor: WorkmailCursor = {
          inbox: inbox.cursor,
          ...(sent === undefined ? {} : { sent: sent.cursor }),
        };

        return {
          messages: [...inbox.messages, ...(sent?.messages ?? [])],
          cursor,
          ownerHandles: [config.user.toLowerCase()],
        };
      });
    } catch (error) {
      // The runner turns this into an erroring heartbeat, which is how the health surface tells a
      // broken account from a quiet one.
      throw new Error(fail(error));
    }
  }

  async function check(): Promise<{ ok: true } | { ok: false; error: string }> {
    let mailboxes: ImapMailboxListing[];
    try {
      mailboxes = await withSession((session) => session.list());
    } catch (error) {
      return { ok: false, error: fail(error) };
    }
    if (findPath(mailboxes, String.raw`\Sent`, SENT_FOLDER_NAMES) === undefined) {
      return { ok: false, error: NO_SENT_FOLDER };
    }
    return { ok: true };
  }

  return {
    key: 'workmail',
    kind: 'imap',
    label: config.label,
    check,
    poll,
  };
}
