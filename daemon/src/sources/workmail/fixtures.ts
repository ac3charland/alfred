/**
 * Test material for the WorkMail source: raw RFC822 messages exactly as an IMAP server hands
 * them over, and an in-memory `ImapSession` that serves them.
 *
 * The messages are written out as headers-plus-body rather than built by a helper, because what
 * is being tested is header handling — a builder that normalized the input would test itself.
 */
import type { ImapConnect, ImapMailboxListing, ImapMessage, ImapSession } from './imap-client.ts';

/** RFC822 wants CRLF between lines, and mailparser is strict enough to notice. */
function message(lines: readonly string[]): string {
  return lines.join('\r\n');
}

/** An ordinary reply: text/plain, a References chain, one Cc, mixed-case addresses. */
export const PLAIN_REPLY = message([
  'From: "Ada Lovelace" <Ada@Example.COM>',
  'To: Support <SUPPORT@realplayapp.com>, Bob <bob@example.com>',
  'Cc: Carol <Carol@Example.com>',
  'Subject: Re: Invoice 42',
  'Date: Mon, 08 Sep 2025 10:00:00 +0000',
  'Message-ID: <reply-1@example.com>',
  'In-Reply-To: <queued-1@example.com>',
  'References: <root-0@example.com> <queued-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Could you re-send the invoice?',
  '',
]);

/** A message whose only readable part is HTML — the shape most marketing mail arrives in. */
export const HTML_ONLY = message([
  'From: Newsroom <news@example.com>',
  'To: support@realplayapp.com',
  'Subject: Product update',
  'Date: Mon, 08 Sep 2025 11:00:00 +0000',
  'Message-ID: <html-1@example.com>',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>Hello <b>there</b>.</p><p>Second paragraph.</p></body></html>',
  '--b1--',
  '',
]);

/** One text part and one attached file, so `has_attachments` has something to be true about. */
export const WITH_ATTACHMENT = message([
  'From: Dana <dana@example.com>',
  'To: support@realplayapp.com',
  'Subject: Signed contract',
  'Date: Mon, 08 Sep 2025 12:00:00 +0000',
  'Message-ID: <attach-1@example.com>',
  'Content-Type: multipart/mixed; boundary="b2"',
  '',
  '--b2',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Attached, as promised.',
  '--b2',
  'Content-Type: text/plain; charset=utf-8; name="contract.txt"',
  'Content-Disposition: attachment; filename="contract.txt"',
  '',
  'the contract',
  '--b2--',
  '',
]);

/** The drain: the owner answered in their own client, and the reply names the queued Message-ID. */
export const SENT_REPLY = message([
  'From: Support <support@realplayapp.com>',
  'To: "Ada Lovelace" <ada@example.com>',
  'Subject: Re: Invoice 42',
  'Date: Mon, 08 Sep 2025 13:00:00 +0000',
  'Message-ID: <sent-1@realplayapp.com>',
  'In-Reply-To: <queued-1@example.com>',
  'References: <root-0@example.com> <queued-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Sent it over just now.',
  '',
]);

/** Bulk mail. The daemon reports its list headers and files it no differently. */
export const NEWSLETTER = message([
  'From: Example Digest <digest@list.example.com>',
  'To: support@realplayapp.com',
  'Subject: Your weekly digest',
  'Date: Mon, 08 Sep 2025 14:00:00 +0000',
  'Message-ID: <news-1@list.example.com>',
  'List-Unsubscribe: <https://list.example.com/u>',
  'List-ID: Example Digest <digest.list.example.com>',
  'Precedence: bulk',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'This week in example.',
  '',
]);

/** No Message-ID: identity and thread key both have to fall back to the mailbox coordinates. */
export const NO_MESSAGE_ID = message([
  'From: Anon <anon@example.com>',
  'To: support@realplayapp.com',
  'Subject: No id here',
  'Date: Mon, 08 Sep 2025 15:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Sent by something that forgot to stamp a Message-ID.',
  '',
]);

/**
 * Stands in for MIME the parser cannot cope with. Real examples are unreproducible (a truncated
 * multipart, an unknown charset, a body the server hands back short), so the test injects a parser
 * that rejects on this marker instead of chasing a byte sequence that breaks a specific version.
 */
export const BROKEN_MIME_MARKER = 'x-alfred-broken-mime';
export const BROKEN_MIME = message([
  'From: Broken <broken@example.com>',
  'To: support@realplayapp.com',
  'Subject: Unparseable',
  'Date: Mon, 08 Sep 2025 16:00:00 +0000',
  'Message-ID: <broken-1@example.com>',
  `X-Alfred-Test: ${BROKEN_MIME_MARKER}`,
  '',
  'body',
  '',
]);

export interface FakeMessage {
  uid: number;
  source: string;
  internalDate: Date;
}

export interface FakeMailbox {
  path: string;
  name: string;
  specialUse?: string;
  uidvalidity: number;
  uidnext?: number;
  messages: FakeMessage[];
}

export interface FakeSession {
  connect: ImapConnect;
  /** Every connect, with the credentials it was handed — so a test can pin where the password came from. */
  connections: { host: string; port: number; user: string; password: string }[];
  opened: string[];
  searches: { path: string; since?: Date; fromUid?: number }[];
  fetched: { path: string; uids: number[] }[];
  logouts: number;
}

function listingOf(mailbox: FakeMailbox): ImapMailboxListing {
  return {
    path: mailbox.path,
    name: mailbox.name,
    ...(mailbox.specialUse === undefined ? {} : { specialUse: mailbox.specialUse }),
  };
}

/**
 * An IMAP server in a variable. It reproduces the two behaviours the source actually depends on:
 * UIDs are ascending within a mailbox, and a `n:*` search always matches the highest UID even when
 * that UID is below `n` — the RFC quirk that would otherwise re-deliver the newest message forever.
 */
export function createFakeSession(mailboxes: readonly FakeMailbox[]): FakeSession {
  const state: FakeSession = {
    connect: () => Promise.reject(new Error('replaced below')),
    connections: [],
    opened: [],
    searches: [],
    fetched: [],
    logouts: 0,
  };

  state.connect = (options): Promise<ImapSession> => {
    state.connections.push({ ...options });
    let current: FakeMailbox | undefined;

    const selected = (): FakeMailbox => {
      if (current === undefined) throw new Error('no mailbox is open');
      return current;
    };
    const sorted = (mailbox: FakeMailbox): FakeMessage[] => {
      const messages = [...mailbox.messages];
      messages.sort((a, b) => a.uid - b.uid);
      return messages;
    };

    const session: ImapSession = {
      list: () => Promise.resolve(mailboxes.map((mailbox) => listingOf(mailbox))),
      open: (path) => {
        const found = mailboxes.find((mailbox) => mailbox.path === path);
        if (found === undefined) return Promise.reject(new Error(`no such mailbox: ${path}`));
        current = found;
        state.opened.push(path);
        const highest = sorted(found).at(-1)?.uid ?? 0;
        return Promise.resolve({
          uidvalidity: found.uidvalidity,
          uidnext: found.uidnext ?? highest + 1,
        });
      },
      searchSince: (since) => {
        const mailbox = selected();
        state.searches.push({ path: mailbox.path, since });
        return Promise.resolve(
          sorted(mailbox)
            .filter((entry) => entry.internalDate.getTime() >= since.getTime())
            .map((entry) => entry.uid),
        );
      },
      searchFrom: (uid) => {
        const mailbox = selected();
        state.searches.push({ path: mailbox.path, fromUid: uid });
        const all = sorted(mailbox);
        const matched = all.filter((entry) => entry.uid >= uid).map((entry) => entry.uid);
        const highest = all.at(-1)?.uid;
        // `UID n:*` is a range, not a lower bound: when n is past the end the server still
        // answers with the newest message.
        if (matched.length === 0 && highest !== undefined) return Promise.resolve([highest]);
        return Promise.resolve(matched);
      },
      fetchUids: (uids) => {
        const mailbox = selected();
        state.fetched.push({ path: mailbox.path, uids: [...uids] });
        const wanted = new Set(uids);
        const messages: ImapMessage[] = sorted(mailbox)
          .filter((entry) => wanted.has(entry.uid))
          .map((entry) => ({
            uid: entry.uid,
            source: Buffer.from(entry.source, 'utf8'),
            internalDate: entry.internalDate,
          }));
        return Promise.resolve(messages);
      },
      logout: () => {
        state.logouts += 1;
        current = undefined;
        return Promise.resolve();
      },
    };

    return Promise.resolve(session);
  };

  return state;
}
