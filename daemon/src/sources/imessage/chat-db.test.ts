import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MAX_ROWS_PER_POLL, checkChatDb, openChatDb } from './chat-db.ts';
import type { ChatDbRow, ReadMessagesInput } from './chat-db.ts';
import type { FixtureContent, FixtureMessage } from './fixtures/chat-db-fixture.ts';
import { writeFixtureChatDb } from './fixtures/chat-db-fixture.ts';

const APPLE_EPOCH_MS = 978_307_200_000;

/** The units current macOS writes: nanoseconds since 2001-01-01. */
function nanoseconds(iso: string): bigint {
  return BigInt(Date.parse(iso) - APPLE_EPOCH_MS) * 1_000_000n;
}

/** The units a pre-2013 chat.db writes: whole seconds since the same epoch. */
function seconds(iso: string): number {
  return (Date.parse(iso) - APPLE_EPOCH_MS) / 1000;
}

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'alfred-chat-db-'));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

let counter = 0;

function fixture(content: FixtureContent): string {
  counter += 1;
  const file = path.join(directory, `chat-${String(counter)}.db`);
  writeFixtureChatDb(file, content);
  return file;
}

function read(file: string, input: Partial<ReadMessagesInput> = {}): ChatDbRow[] {
  const database = openChatDb(file);
  try {
    return database.readMessages({ anchor: new Date('2000-01-01T00:00:00.000Z'), ...input });
  } finally {
    database.close();
  }
}

const CHATS = [
  { guid: 'iMessage;-;+13125550100', identifier: '+13125550100', participants: ['+13125550100'] },
  {
    guid: 'iMessage;+;chat904',
    identifier: 'chat904',
    displayName: 'Weekend plans',
    roomName: 'chat904',
    participants: ['+13125550100', 'dana@example.com'],
  },
];

const ONE_TO_ONE: FixtureMessage = {
  rowid: 10,
  guid: 'A1',
  text: 'are you around',
  date: nanoseconds('2026-09-01T12:00:00.000Z'),
  handle: '+13125550100',
  chat: 'iMessage;-;+13125550100',
};

describe('checkChatDb', () => {
  it('passes on a database it can open and read', () => {
    expect(checkChatDb(fixture({ chats: CHATS, messages: [ONE_TO_ONE] }))).toEqual({ ok: true });
  });

  it('names Full Disk Access and the path when the file is not there', () => {
    const missing = path.join(directory, 'nowhere', 'chat.db');

    const result = checkChatDb(missing);

    expect(result).toMatchObject({ ok: false });
    const error = 'error' in result ? result.error : '';
    expect(error).toContain(missing);
    expect(error).toContain('Full Disk Access');
  });

  it('names the missing column when the schema has drifted out from under us', () => {
    counter += 1;
    const file = path.join(directory, `drifted-${String(counter)}.db`);
    const database = new DatabaseSync(file);
    database.exec('create table message (ROWID integer primary key, guid text, date integer)');
    database.exec('create table handle (ROWID integer primary key, id text)');
    database.exec('create table chat (ROWID integer primary key, guid text, chat_identifier text)');
    database.exec('create table chat_message_join (chat_id integer, message_id integer)');
    database.exec('create table chat_handle_join (chat_id integer, handle_id integer)');
    database.close();

    const result = checkChatDb(file);

    expect(result).toMatchObject({ ok: false });
    expect('error' in result ? result.error : '').toContain('message.attributedBody');
  });
});

describe('busy_timeout', () => {
  it('waits out a transient lock instead of failing immediately', () => {
    const file = fixture({ chats: CHATS, messages: [ONE_TO_ONE] });
    // Messages.app itself, or a WAL checkpoint, can hold a lock for a moment; sqlite's own
    // default busy_timeout is 0, which fails a racing read instantly rather than waiting a
    // transient lock out. BEGIN EXCLUSIVE blocks every other connection — reader or writer —
    // for as long as this transaction is open, standing in for that race.
    const locker = new DatabaseSync(file);
    locker.exec('BEGIN EXCLUSIVE');
    try {
      const start = Date.now();
      expect(() => read(file)).toThrow();
      const elapsed = Date.now() - start;
      // Without a busy_timeout, sqlite fails within a few ms. The lock is held for the whole
      // test, so a failure only after waiting out most of a 2s busy_timeout proves the pragma
      // is actually in effect, not merely present in the source.
      expect(elapsed).toBeGreaterThan(1000);
    } finally {
      locker.exec('COMMIT');
    }
  }, 10_000);
});

describe('openChatDb().readMessages', () => {
  it('reads everything after the cursor and nothing at or before it', () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...ONE_TO_ONE, rowid: 10, guid: 'A1' },
        { ...ONE_TO_ONE, rowid: 11, guid: 'A2' },
        { ...ONE_TO_ONE, rowid: 12, guid: 'A3' },
      ],
    });

    expect(read(file, { cursor: { rowid: 10 } }).map((row) => row.guid)).toEqual(['A2', 'A3']);
  });

  it('falls back to the anchor when there is no cursor, ignoring anything older', () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...ONE_TO_ONE, rowid: 10, guid: 'OLD', date: nanoseconds('2026-08-01T12:00:00.000Z') },
        { ...ONE_TO_ONE, rowid: 11, guid: 'NEW', date: nanoseconds('2026-09-01T12:00:00.000Z') },
      ],
    });

    const rows = read(file, { anchor: new Date('2026-08-25T00:00:00.000Z') });

    expect(rows.map((row) => row.guid)).toEqual(['NEW']);
  });

  it('reads a seconds-resolution date against the anchor as well as a nanosecond one', () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...ONE_TO_ONE, rowid: 10, guid: 'OLD', date: seconds('2026-08-01T12:00:00.000Z') },
        { ...ONE_TO_ONE, rowid: 11, guid: 'NEW', date: seconds('2026-09-01T12:00:00.000Z') },
      ],
    });

    const rows = read(file, { anchor: new Date('2026-08-25T00:00:00.000Z') });

    expect(rows.map((row) => row.guid)).toEqual(['NEW']);
    expect(rows[0]?.date).toBe(BigInt(seconds('2026-09-01T12:00:00.000Z')));
  });

  it('orders by ROWID and stops at the poll cap, leaving the rest for the next poll', () => {
    const messages = Array.from({ length: MAX_ROWS_PER_POLL + 100 }, (_, index) => ({
      ...ONE_TO_ONE,
      rowid: 1000 - index, // inserted newest-first, so a ROWID sort has something to do
      guid: `G${String(1000 - index)}`,
    }));
    const file = fixture({ chats: CHATS, messages });

    const rows = read(file);

    expect(rows).toHaveLength(MAX_ROWS_PER_POLL);
    expect(rows[0]?.rowid).toBe(401);
    expect(rows.at(-1)?.rowid).toBe(401 + MAX_ROWS_PER_POLL - 1);
  });

  it('honours a smaller limit', () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...ONE_TO_ONE, rowid: 10, guid: 'A1' },
        { ...ONE_TO_ONE, rowid: 11, guid: 'A2' },
      ],
    });

    expect(read(file, { limit: 1 }).map((row) => row.guid)).toEqual(['A1']);
  });

  it('skips tapbacks and group-membership events, which are not messages', () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...ONE_TO_ONE, rowid: 10, guid: 'REAL' },
        { ...ONE_TO_ONE, rowid: 11, guid: 'LIKED', associatedMessageType: 2000 },
        { ...ONE_TO_ONE, rowid: 12, guid: 'UNLIKED', associatedMessageType: 3000 },
        { ...ONE_TO_ONE, rowid: 13, guid: 'RENAMED', itemType: 2 },
        { ...ONE_TO_ONE, rowid: 14, guid: 'JOINED', itemType: 1 },
        { ...ONE_TO_ONE, rowid: 15, guid: 'ALSO-REAL' },
      ],
    });

    expect(read(file).map((row) => row.guid)).toEqual(['REAL', 'ALSO-REAL']);
  });

  it('keeps a reply, which carries an associated guid but is still a message', () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...ONE_TO_ONE, rowid: 10, guid: 'REPLY', associatedMessageType: 0 }],
    });

    expect(read(file).map((row) => row.guid)).toEqual(['REPLY']);
  });

  it('carries the chat, its participants and the sender handle alongside each row', () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...ONE_TO_ONE, rowid: 10, guid: 'G1', chat: 'iMessage;+;chat904' }],
    });

    expect(read(file)[0]).toMatchObject({
      guid: 'G1',
      handle: '+13125550100',
      isFromMe: false,
      hasAttachments: false,
      chat: {
        guid: 'iMessage;+;chat904',
        identifier: 'chat904',
        displayName: 'Weekend plans',
        roomName: 'chat904',
        participants: ['+13125550100', 'dana@example.com'],
      },
    });
  });

  it('reads an outbound row, which has no handle of its own', () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...ONE_TO_ONE, rowid: 10, guid: 'OUT', isFromMe: true, handle: undefined }],
    });

    const row = read(file)[0];

    expect(row).toMatchObject({ guid: 'OUT', isFromMe: true });
    expect(row).not.toHaveProperty('handle');
  });

  it('carries the attributedBody blob and the attachment flag through untouched', () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const file = fixture({
      chats: CHATS,
      messages: [
        {
          ...ONE_TO_ONE,
          rowid: 10,
          guid: 'BLOB',
          text: undefined,
          attributedBody: blob,
          hasAttachments: true,
        },
      ],
    });

    const row = read(file)[0];

    expect(row?.text).toBeUndefined();
    expect(row?.attributedBody).toEqual(blob);
    expect(row?.hasAttachments).toBe(true);
  });

  it('reads a row that belongs to no chat at all', () => {
    const file = fixture({
      messages: [{ ...ONE_TO_ONE, rowid: 10, guid: 'ORPHAN', chat: undefined }],
    });

    const row = read(file)[0];

    expect(row).toMatchObject({ guid: 'ORPHAN' });
    expect(row).not.toHaveProperty('chat');
  });
});
