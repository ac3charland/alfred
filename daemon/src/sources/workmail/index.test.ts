import type { WorkmailSourceConfig } from '../../config.ts';
import type { NormalizedMessage } from '../../contract.ts';
import type { LogFields, Logger } from '../../log.ts';
import type { SourceContext } from '../types.ts';
import {
  BROKEN_MIME,
  BROKEN_MIME_MARKER,
  HTML_ONLY,
  NEWSLETTER,
  NO_MESSAGE_ID,
  PLAIN_REPLY,
  SENT_REPLY,
  WITH_ATTACHMENT,
  createFakeSession,
} from './fixtures.ts';
import type { FakeMailbox, FakeMessage } from './fixtures.ts';
import {
  MAX_MESSAGES_PER_MAILBOX,
  WORKMAIL_STALL_CEILING,
  WORKMAIL_UID_STALLED,
  createWorkmailSource,
} from './index.ts';
import { parseMime } from './mime.ts';

const CONFIG: WorkmailSourceConfig = {
  enabled: true,
  host: 'imap.mail.us-east-1.awsapps.com',
  port: 993,
  // Deliberately mis-cased: every handle the daemon reports is lower-cased.
  user: 'Support@RealPlayApp.com',
  label: 'WorkMail',
};

const PASSWORD = 'imap-password';
const ANCHOR = new Date('2025-09-01T00:00:00.000Z');
const NOW = new Date('2025-09-08T18:00:00.000Z');
const INBOX_UIDVALIDITY = 77;
const SENT_UIDVALIDITY = 88;

const secrets = (name: string): Promise<string> =>
  name === 'workmail-imap-password'
    ? Promise.resolve(PASSWORD)
    : Promise.reject(new Error(`unexpected secret "${name}"`));

function context(overrides: Partial<SourceContext> = {}): SourceContext {
  return { cursor: undefined, anchor: ANCHOR, now: NOW, secrets, ...overrides };
}

function at(uid: number, source: string, isoDate = '2025-09-05T10:00:00.000Z'): FakeMessage {
  return { uid, source, internalDate: new Date(isoDate) };
}

function inbox(messages: FakeMessage[], uidvalidity = INBOX_UIDVALIDITY): FakeMailbox {
  return { path: 'INBOX', name: 'INBOX', specialUse: String.raw`\Inbox`, uidvalidity, messages };
}

function sent(messages: FakeMessage[], uidvalidity = SENT_UIDVALIDITY): FakeMailbox {
  return {
    path: 'Sent Items',
    name: 'Sent Items',
    specialUse: String.raw`\Sent`,
    uidvalidity,
    messages,
  };
}

/** The parser the daemon really uses, except that the broken-MIME fixture makes it give up. */
const parseWithOneBadMessage = (source: Buffer | string): ReturnType<typeof parseMime> =>
  source.toString().includes(BROKEN_MIME_MARKER)
    ? Promise.reject(new Error('Unexpected end of multipart'))
    : parseMime(source);

function sourceOver(
  mailboxes: FakeMailbox[],
  parse = parseMime,
): {
  poll: (ctx?: SourceContext) => Promise<{
    messages: NormalizedMessage[];
    cursor: unknown;
    ownerHandles: string[];
  }>;
  check: () => Promise<{ ok: true } | { ok: false; error: string }>;
  fake: ReturnType<typeof createFakeSession>;
} {
  const fake = createFakeSession(mailboxes);
  const source = createWorkmailSource(CONFIG, { connect: fake.connect, secrets, parse });
  return {
    poll: (ctx = context()) => source.poll(ctx),
    check: () => source.check(),
    fake,
  };
}

/** The single message one poll produced — the shape most normalization cases assert on. */
async function only(mailboxes: FakeMailbox[], parse = parseMime): Promise<NormalizedMessage> {
  const { poll } = sourceOver(mailboxes, parse);
  const result = await poll();
  const [message] = result.messages;
  if (message === undefined) throw new Error('expected exactly one message');
  return message;
}

interface LoggedCall {
  level: 'info' | 'warn' | 'error';
  message: string;
  fields?: LogFields;
}

/** Records every call by level, so a test can assert a swallowed failure was still reported. */
function spyLogger(): { calls: LoggedCall[]; log: Logger } {
  const calls: LoggedCall[] = [];
  const record =
    (level: LoggedCall['level']) =>
    (message: string, fields?: LogFields): void => {
      calls.push(fields === undefined ? { level, message } : { level, message, fields });
    };
  return { calls, log: { info: record('info'), warn: record('warn'), error: record('error') } };
}

describe('createWorkmailSource', () => {
  it('identifies itself to the ingest endpoint as an IMAP account', () => {
    const source = createWorkmailSource(CONFIG);

    expect(source.key).toBe('workmail');
    expect(source.kind).toBe('imap');
    expect(source.label).toBe('WorkMail');
  });

  it('reports the mailbox user as the owner handle, lower-cased', async () => {
    const { poll } = sourceOver([inbox([]), sent([])]);

    await expect(poll()).resolves.toMatchObject({ ownerHandles: ['support@realplayapp.com'] });
  });
});

describe('WorkMail poll', () => {
  it('reads the password by name from the keychain and closes the session afterwards', async () => {
    const { poll, fake } = sourceOver([inbox([at(1, PLAIN_REPLY)]), sent([])]);

    await poll();

    expect(fake.connections).toEqual([
      { host: CONFIG.host, port: CONFIG.port, user: CONFIG.user, password: PASSWORD },
    ]);
    expect(fake.logouts).toBe(1);
  });

  it('seeds a first run from the anchor rather than from the whole mailbox', async () => {
    const { poll, fake } = sourceOver([inbox([at(1, PLAIN_REPLY)]), sent([at(4, SENT_REPLY)])]);

    const result = await poll();

    expect(fake.searches).toEqual([
      { path: 'INBOX', since: ANCHOR },
      { path: 'Sent Items', since: ANCHOR },
    ]);
    expect(result.cursor).toEqual({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 1 },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 4 },
    });
    expect(result.messages).toHaveLength(2);
  });

  it('leaves nothing behind the anchor: a message older than it is never ingested', async () => {
    const { poll } = sourceOver([
      inbox([at(1, PLAIN_REPLY, '2025-08-01T10:00:00.000Z'), at(2, HTML_ONLY)]),
      sent([]),
    ]);

    const result = await poll();

    expect(result.messages.map((message) => message.source_id)).toEqual(['<html-1@example.com>']);
  });

  it('reads forward from the cursor once it has one, per mailbox', async () => {
    const { poll, fake } = sourceOver([
      inbox([at(1, PLAIN_REPLY), at(2, HTML_ONLY)]),
      sent([at(4, SENT_REPLY)]),
    ]);

    const result = await poll(
      context({
        cursor: {
          inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 1 },
          sent: { uidvalidity: SENT_UIDVALIDITY, uid: 4 },
        },
      }),
    );

    expect(fake.searches).toEqual([
      { path: 'INBOX', fromUid: 2 },
      { path: 'Sent Items', fromUid: 5 },
    ]);
    expect(result.messages.map((message) => message.source_id)).toEqual(['<html-1@example.com>']);
    expect(result.cursor).toEqual({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 2 },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 4 },
    });
  });

  it('does not re-deliver the newest message when a UID range search runs past the end', async () => {
    // `UID 3:*` is a range: a server with nothing above UID 2 answers with UID 2 regardless.
    const { poll } = sourceOver([inbox([at(1, PLAIN_REPLY), at(2, HTML_ONLY)]), sent([])]);

    const result = await poll(
      context({ cursor: { inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 2 } } }),
    );

    expect(result.messages).toEqual([]);
    expect(result.cursor).toEqual({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 2 },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 0 },
    });
  });

  it('re-seeds from the anchor when UIDVALIDITY changed, because every UID moved', async () => {
    const { poll, fake } = sourceOver([inbox([at(1, PLAIN_REPLY)], 99), sent([])]);

    const result = await poll(
      context({ cursor: { inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 40 } } }),
    );

    expect(fake.searches).toContainEqual({ path: 'INBOX', since: ANCHOR });
    expect(result.messages.map((message) => message.source_id)).toEqual(['<reply-1@example.com>']);
    expect(result.cursor).toMatchObject({ inbox: { uidvalidity: 99, uid: 1 } });
  });

  it('caps one poll per mailbox and leaves the cursor on the last message it emitted', async () => {
    const many = Array.from({ length: MAX_MESSAGES_PER_MAILBOX + 50 }, (_, index) =>
      at(index + 1, PLAIN_REPLY),
    );
    const { poll, fake } = sourceOver([inbox(many), sent([])]);

    const result = await poll();

    expect(result.messages).toHaveLength(MAX_MESSAGES_PER_MAILBOX);
    expect(result.cursor).toMatchObject({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: MAX_MESSAGES_PER_MAILBOX },
    });
    expect(fake.fetched[0]?.uids).toHaveLength(MAX_MESSAGES_PER_MAILBOX);
  });

  it('holds the cursor still when a mailbox had nothing new', async () => {
    const { poll } = sourceOver([inbox([at(1, PLAIN_REPLY)]), sent([])]);

    const result = await poll(
      context({
        cursor: {
          inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 1 },
          sent: { uidvalidity: SENT_UIDVALIDITY, uid: 9 },
        },
      }),
    );

    expect(result.cursor).toEqual({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 1 },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 9 },
    });
  });

  it('never advances the cursor past a uid the server failed to return mid-batch', async () => {
    // SEARCH reports 10, 11, 12; FETCH comes back missing 11 (a concurrent expunge, a flaky
    // server) but still returns the later uid 12 in the same batch.
    const fake = createFakeSession([
      inbox([at(10, PLAIN_REPLY), at(11, HTML_ONLY), at(12, NEWSLETTER)]),
      sent([]),
    ]);
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: async (options) => {
        const session = await fake.connect(options);
        return {
          ...session,
          fetchUids: async (uids) => {
            const messages = await session.fetchUids(uids);
            return messages.filter((message) => message.uid !== 11);
          },
        };
      },
    });

    const result = await source.poll(context());

    // 10 and 12 still go out — they were fetched successfully — but the cursor must not jump
    // past the missing 11, or the next poll would never ask for it again.
    expect(result.messages.map((message) => message.source_id)).toEqual([
      '<reply-1@example.com>',
      '<news-1@list.example.com>',
    ]);
    expect(result.cursor).toMatchObject({ inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 10 } });
  });

  it('retries a uid that was missing mid-batch once the cursor holds it back', async () => {
    const fake = createFakeSession([
      inbox([at(10, PLAIN_REPLY), at(11, HTML_ONLY), at(12, NEWSLETTER)]),
      sent([]),
    ]);
    let calls = 0;
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: async (options) => {
        const session = await fake.connect(options);
        return {
          ...session,
          fetchUids: async (uids) => {
            calls += 1;
            const messages = await session.fetchUids(uids);
            // Only the first fetch drops uid 11 — the second, standing in for a retry against a
            // server that is no longer flaky, returns everything it was asked for.
            return calls === 1 ? messages.filter((message) => message.uid !== 11) : messages;
          },
        };
      },
    });

    const first = await source.poll(context());
    const second = await source.poll(context({ cursor: first.cursor }));

    expect(second.messages.map((message) => message.source_id)).toEqual([
      '<html-1@example.com>',
      '<news-1@list.example.com>',
    ]);
    // Full equality, not just toMatchObject: this also proves the stall counter the ceiling below
    // relies on does not linger once real progress is made — a later, unrelated stall must not
    // inherit attempts it never made.
    expect(second.cursor).toEqual({
      inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 12 },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 0 },
    });
  });

  it('keeps quietly holding at the gap through repeated polls, short of the stall ceiling', async () => {
    // uid 11 is never fetchable, on every single poll — nothing transient about it, unlike the
    // "retries a uid..." case above. Short of the ceiling this must still read exactly like an
    // ordinary transient gap: no error, no escalation, just held at 10.
    const fake = createFakeSession([
      inbox([at(10, PLAIN_REPLY), at(11, HTML_ONLY), at(12, NEWSLETTER)]),
      sent([]),
    ]);
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: async (options) => {
        const session = await fake.connect(options);
        return {
          ...session,
          fetchUids: async (uids) => {
            const messages = await session.fetchUids(uids);
            return messages.filter((message) => message.uid !== 11);
          },
        };
      },
    });

    let cursor: unknown;
    for (let i = 0; i < WORKMAIL_STALL_CEILING; i += 1) {
      const result = await source.poll(context({ cursor }));
      cursor = result.cursor;
    }

    expect(cursor).toEqual({
      inbox: {
        uidvalidity: INBOX_UIDVALIDITY,
        uid: 10,
        stalledAttempts: WORKMAIL_STALL_CEILING - 1,
      },
      sent: { uidvalidity: SENT_UIDVALIDITY, uid: 0 },
    });
  });

  it('escalates loudly once a uid stays stuck past the stall ceiling, rather than wedging silently', async () => {
    const fake = createFakeSession([
      inbox([at(10, PLAIN_REPLY), at(11, HTML_ONLY), at(12, NEWSLETTER)]),
      sent([]),
    ]);
    const { log, calls } = spyLogger();
    const source = createWorkmailSource(CONFIG, {
      secrets,
      log,
      connect: async (options) => {
        const session = await fake.connect(options);
        return {
          ...session,
          fetchUids: async (uids) => {
            const messages = await session.fetchUids(uids);
            return messages.filter((message) => message.uid !== 11);
          },
        };
      },
    });

    let cursor: unknown;
    for (let i = 0; i < WORKMAIL_STALL_CEILING; i += 1) {
      const result = await source.poll(context({ cursor }));
      cursor = result.cursor;
    }

    // The ceiling'th consecutive stalled poll gives up rather than holding forever, and says so
    // with a distinct, matchable error — mirroring the sibling Gmail LISTING_STALLED escalation.
    await expect(source.poll(context({ cursor }))).rejects.toThrow(WORKMAIL_UID_STALLED);

    const loudly = calls.some(
      (call) =>
        call.level === 'error' && call.fields?.['uid'] === 11 && call.fields['path'] === 'INBOX',
    );
    expect(loudly).toBe(true);
  });
});

describe('WorkMail normalization', () => {
  it('maps an inbound reply onto the wire contract', async () => {
    const message = await only([inbox([at(12, PLAIN_REPLY)]), sent([])]);

    expect(message).toEqual({
      source_id: '<reply-1@example.com>',
      rfc822_message_id: '<reply-1@example.com>',
      thread_key: '<root-0@example.com>',
      direction: 'inbound',
      sender_handle: 'ada@example.com',
      sender_name: 'Ada Lovelace',
      participants: ['support@realplayapp.com', 'bob@example.com', 'carol@example.com'],
      subject: 'Re: Invoice 42',
      body: 'Could you re-send the invoice?',
      // The IMAP server's own INTERNALDATE (`at()`'s default), not the header — a sender-written
      // `Date:` must never be able to steer this. See normalize.test.ts.
      received_at: '2025-09-05T10:00:00.000Z',
      body_extracted: true,
      has_attachments: false,
      in_reply_to: '<queued-1@example.com>',
      references_ids: ['<root-0@example.com>', '<queued-1@example.com>'],
    });
  });

  it('marks what the Sent folder holds as outbound, carrying the ids the drain matches on', async () => {
    const message = await only([inbox([]), sent([at(4, SENT_REPLY)])]);

    expect(message).toMatchObject({
      direction: 'outbound',
      sender_handle: 'support@realplayapp.com',
      in_reply_to: '<queued-1@example.com>',
      references_ids: ['<root-0@example.com>', '<queued-1@example.com>'],
      thread_key: '<root-0@example.com>',
    });
  });

  it('threads a message with no References on its In-Reply-To', async () => {
    const noReferences = SENT_REPLY.replace(
      'References: <root-0@example.com> <queued-1@example.com>\r\n',
      '',
    );

    const message = await only([inbox([]), sent([at(4, noReferences)])]);

    expect(message).toMatchObject({
      thread_key: '<queued-1@example.com>',
      references_ids: [],
    });
  });

  it('starts a thread on the message own id when nothing points backwards', async () => {
    const message = await only([inbox([at(3, HTML_ONLY)]), sent([])]);

    expect(message).toMatchObject({
      thread_key: '<html-1@example.com>',
      source_id: '<html-1@example.com>',
      body: 'Hello there.\nSecond paragraph.',
    });
  });

  it('identifies a message with no Message-ID by its mailbox coordinates', async () => {
    const message = await only([inbox([at(31, NO_MESSAGE_ID)]), sent([])]);

    expect(message).toMatchObject({
      source_id: `${String(INBOX_UIDVALIDITY)}:31`,
      thread_key: `${String(INBOX_UIDVALIDITY)}:31`,
    });
    expect(message.rfc822_message_id).toBeUndefined();
  });

  it('flags an attachment', async () => {
    const message = await only([inbox([at(5, WITH_ATTACHMENT)]), sent([])]);

    expect(message).toMatchObject({ has_attachments: true, body: 'Attached, as promised.' });
  });

  it('sends a message it could not parse anyway, flagged, rather than dropping it', async () => {
    const message = await only(
      [inbox([at(7, BROKEN_MIME, '2025-09-06T09:30:00.000Z')]), sent([])],
      parseWithOneBadMessage,
    );

    expect(message).toEqual({
      source_id: `${String(INBOX_UIDVALIDITY)}:7`,
      thread_key: `${String(INBOX_UIDVALIDITY)}:7`,
      direction: 'inbound',
      sender_handle: '',
      participants: [],
      body: '',
      // No headers survived, so the server's own delivery time is all that is left.
      received_at: '2025-09-06T09:30:00.000Z',
      body_extracted: false,
      has_attachments: false,
      references_ids: [],
    });
  });

  it('keeps polling the rest of the mailbox after a message it could not parse', async () => {
    const { poll } = sourceOver(
      [inbox([at(7, BROKEN_MIME), at(8, PLAIN_REPLY)]), sent([])],
      parseWithOneBadMessage,
    );

    const result = await poll();

    expect(result.messages.map((message) => message.body_extracted)).toEqual([false, true]);
    expect(result.cursor).toMatchObject({ inbox: { uid: 8 } });
  });

  it('names the bulk-mail headers a newsletter carries and lets it through unchanged', async () => {
    const message = await only([inbox([at(9, NEWSLETTER)]), sent([])]);

    expect(message).toMatchObject({
      source_id: '<news-1@list.example.com>',
      subject: 'Your weekly digest',
      list_headers: ['list-unsubscribe', 'list-id', 'precedence'],
    });
  });

  it('omits list_headers entirely for ordinary mail', async () => {
    const message = await only([inbox([at(12, PLAIN_REPLY)]), sent([])]);

    expect('list_headers' in message).toBe(false);
  });
});

describe('WorkMail Sent folder discovery', () => {
  it('prefers the folder the server marked as its sent folder', async () => {
    const { poll, fake } = sourceOver([
      inbox([]),
      {
        path: 'Sent Items',
        name: 'Sent Items',
        specialUse: String.raw`\Sent`,
        uidvalidity: 88,
        messages: [],
      },
    ]);

    await poll();

    expect(fake.opened).toEqual(['INBOX', 'Sent Items']);
  });

  it('falls back to a folder named like a sent folder when no flag is advertised', async () => {
    const { poll, fake } = sourceOver([
      inbox([]),
      { path: 'Sent Messages', name: 'Sent Messages', uidvalidity: 88, messages: [] },
    ]);

    await poll();

    expect(fake.opened).toEqual(['INBOX', 'Sent Messages']);
  });

  it('still ingests the inbox when there is no sent folder to watch', async () => {
    const { poll } = sourceOver([inbox([at(1, PLAIN_REPLY)])]);

    const result = await poll();

    expect(result.messages).toHaveLength(1);
    expect(result.cursor).toEqual({ inbox: { uidvalidity: INBOX_UIDVALIDITY, uid: 1 } });
  });
});

describe('WorkMail check', () => {
  it('passes once it can log in and list the two folders it reads', async () => {
    const { check, fake } = sourceOver([inbox([]), sent([])]);

    await expect(check()).resolves.toEqual({ ok: true });
    expect(fake.logouts).toBe(1);
  });

  it('fails when the mailbox has no sent folder, because the reply drain would be blind', async () => {
    const { check } = sourceOver([inbox([])]);

    await expect(check()).resolves.toEqual({
      ok: false,
      error:
        'no sent folder found — a reply sent from the mail client cannot clear the message it answers',
    });
  });

  it('names a rejected login as a rejected login', async () => {
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: () =>
        Promise.reject(
          Object.assign(new Error('Invalid credentials'), { authenticationFailed: true }),
        ),
    });

    await expect(source.check()).resolves.toEqual({
      ok: false,
      error:
        `IMAP login was rejected by ${CONFIG.host} — the mailbox password in the keychain is wrong, ` +
        'or the account is locked',
    });
  });

  it('names an unreachable server as a network failure', async () => {
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: () => Promise.reject(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })),
    });

    await expect(source.check()).resolves.toEqual({
      ok: false,
      error: `could not reach ${CONFIG.host}:993 — the host name did not resolve`,
    });
  });

  it('reports a missing keychain item without guessing at the network', async () => {
    const source = createWorkmailSource(CONFIG, {
      secrets: () => Promise.reject(new Error('keychain item "alfred-workmail-imap" is empty')),
      connect: () => Promise.reject(new Error('never reached')),
    });

    await expect(source.check()).resolves.toEqual({
      ok: false,
      error: 'keychain item "alfred-workmail-imap" is empty',
    });
  });
});

describe('WorkMail poll failures', () => {
  it('throws in plain English so the runner can beat an erroring heartbeat', async () => {
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: () =>
        Promise.reject(
          Object.assign(new Error(`LOGIN ${PASSWORD} failed`), { authenticationFailed: true }),
        ),
    });

    const thrown: unknown = await source.poll(context()).catch((error: unknown) => error);
    const detail = thrown instanceof Error ? thrown.message : String(thrown);

    expect(detail).toContain('IMAP login was rejected');
    // Whatever the server said, the password never travels into a log line.
    expect(detail).not.toContain(PASSWORD);
  });

  it('closes the session even when a mailbox read fails', async () => {
    const fake = createFakeSession([inbox([]), sent([])]);
    const source = createWorkmailSource(CONFIG, {
      secrets,
      connect: async (options) => {
        const session = await fake.connect(options);
        return { ...session, open: () => Promise.reject(new Error('mailbox gone')) };
      },
    });

    await expect(source.poll(context())).rejects.toThrow('IMAP request failed — mailbox gone');
    expect(fake.logouts).toBe(1);
  });

  it('propagates the original failure even when logout() also throws on the dead connection', async () => {
    const fake = createFakeSession([inbox([]), sent([])]);
    let logoutAttempted = false;
    const { log, calls } = spyLogger();
    const source = createWorkmailSource(CONFIG, {
      secrets,
      log,
      connect: async (options) => {
        const session = await fake.connect(options);
        return {
          ...session,
          list: () => Promise.reject(new Error('malformed SEARCH response')),
          logout: () => {
            logoutAttempted = true;
            return Promise.reject(new Error('connection already closed'));
          },
        };
      },
    });

    const thrown: unknown = await source.poll(context()).catch((error: unknown) => error);
    const detail = thrown instanceof Error ? thrown.message : String(thrown);

    expect(detail).toContain('malformed SEARCH response');
    expect(detail).not.toContain('connection already closed');
    expect(logoutAttempted).toBe(true);
    // The teardown failure is not silent, just not allowed to replace the real error.
    const warnedAboutLogout = calls.some(
      (call) => call.level === 'warn' && call.message.includes('logout'),
    );
    expect(warnedAboutLogout).toBe(true);
  });
});
