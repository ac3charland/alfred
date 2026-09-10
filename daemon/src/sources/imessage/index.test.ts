import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SourceContext } from '../types.ts';
import type { FixtureContent, FixtureMessage } from './fixtures/chat-db-fixture.ts';
import { writeFixtureChatDb } from './fixtures/chat-db-fixture.ts';
import { attributedBodyFor } from './fixtures/typedstream-fixture.ts';
import { createIMessageSource } from './index.ts';

const CONFIG = { enabled: true, label: 'iMessage' };
const APPLE_EPOCH_MS = 978_307_200_000;

function nanoseconds(iso: string): bigint {
  return BigInt(Date.parse(iso) - APPLE_EPOCH_MS) * 1_000_000n;
}

const NAMES = new Map([
  ['+13125550100', 'Dana Reyes'],
  ['dana@example.com', 'Dana Reyes'],
]);

const CONTACTS = {
  nameFor: (handle: string): string | undefined => NAMES.get(handle),
};

const CHATS = [
  { guid: 'iMessage;-;+13125550100', identifier: '+13125550100', participants: ['+13125550100'] },
  {
    guid: 'iMessage;+;chat904',
    identifier: 'chat904',
    displayName: 'Weekend plans',
    roomName: 'chat904',
    participants: ['+13125550100', 'sam@example.com'],
  },
];

const INBOUND: FixtureMessage = {
  rowid: 10,
  guid: '11AA-BB',
  text: 'are you around',
  date: nanoseconds('2026-09-01T12:00:00.000Z'),
  handle: '(312) 555-0100',
  chat: 'iMessage;-;+13125550100',
};

let directory: string;
let counter = 0;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'alfred-imessage-'));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function fixture(content: FixtureContent): string {
  counter += 1;
  const file = path.join(directory, `chat-${String(counter)}.db`);
  writeFixtureChatDb(file, content);
  return file;
}

function context(overrides: Partial<SourceContext> = {}): SourceContext {
  return {
    cursor: undefined,
    anchor: new Date('2026-08-25T00:00:00.000Z'),
    now: new Date('2026-09-01T12:05:00.000Z'),
    secrets: (name: string): Promise<string> => {
      throw new Error(`the iMessage source asked for a secret it should never need: ${name}`);
    },
    ...overrides,
  };
}

function sourceFor(file: string): ReturnType<typeof createIMessageSource> {
  return createIMessageSource(CONFIG, { databasePath: file, contacts: CONTACTS });
}

describe('createIMessageSource', () => {
  it('identifies itself as the iMessage account', () => {
    const source = sourceFor(fixture({ messages: [] }));

    expect(source).toMatchObject({ key: 'imessage', kind: 'imessage', label: 'iMessage' });
  });

  it('reports healthy when it can read the database', async () => {
    await expect(sourceFor(fixture({ messages: [] })).check()).resolves.toEqual({ ok: true });
  });

  it('reports the Full Disk Access failure rather than polling into the void', async () => {
    const source = sourceFor(path.join(directory, 'gone', 'chat.db'));

    await expect(source.check()).resolves.toMatchObject({ ok: false });
  });

  it('normalizes an inbound one-to-one message', async () => {
    const source = sourceFor(fixture({ chats: CHATS, messages: [INBOUND] }));

    const { messages } = await source.poll(context());

    expect(messages).toEqual([
      {
        source_id: '11AA-BB',
        thread_key: 'iMessage;-;+13125550100',
        direction: 'inbound',
        sender_handle: '+13125550100',
        sender_name: 'Dana Reyes',
        participants: ['+13125550100'],
        body: 'are you around',
        received_at: '2026-09-01T12:00:00.000Z',
        body_extracted: true,
        has_attachments: false,
        references_ids: [],
      },
    ]);
  });

  it('leaves the sender name out when the address book has never heard of the handle', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...INBOUND, handle: '+13125559999' }],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).not.toHaveProperty('sender_name');
  });

  it('marks a message the owner sent as outbound, sent by "me"', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...INBOUND, isFromMe: true, handle: undefined }],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).toMatchObject({ direction: 'outbound', sender_handle: 'me' });
    expect(messages[0]).not.toHaveProperty('sender_name');
  });

  it('carries a group chat’s name and everyone in it, so the classifier can weigh both', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...INBOUND, chat: 'iMessage;+;chat904' }],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).toMatchObject({
      thread_key: 'iMessage;+;chat904',
      chat_name: 'Weekend plans',
      participants: ['+13125550100', 'sam@example.com'],
    });
  });

  it('gives a one-to-one chat no chat name — there is no group to name', async () => {
    const { messages } = await sourceFor(fixture({ chats: CHATS, messages: [INBOUND] })).poll(
      context(),
    );

    expect(messages[0]).not.toHaveProperty('chat_name');
  });

  it('decodes the body out of attributedBody when the text column is empty', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...INBOUND, text: undefined, attributedBody: attributedBodyFor('sent from dictation') },
      ],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).toMatchObject({ body: 'sent from dictation', body_extracted: true });
  });

  it('still emits a row whose body will not decode, flagged so nothing is lost silently', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        {
          ...INBOUND,
          text: undefined,
          attributedBody: new Uint8Array([0x04, 0x0b, 0x99, 0x42]),
        },
      ],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: '', body_extracted: false });
  });

  it('treats an empty message with nothing to decode as extracted, not as a failure', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...INBOUND, text: undefined, attributedBody: undefined }],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).toMatchObject({ body: '', body_extracted: true });
  });

  it('flags a message that carries an attachment', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [{ ...INBOUND, hasAttachments: true }],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages[0]).toMatchObject({ has_attachments: true });
  });

  it('leaves tapbacks and membership events off the shelf', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...INBOUND, rowid: 10, guid: 'REAL' },
        { ...INBOUND, rowid: 11, guid: 'LIKED', associatedMessageType: 2001 },
        { ...INBOUND, rowid: 12, guid: 'RENAMED', itemType: 2 },
      ],
    });

    const { messages } = await sourceFor(file).poll(context());

    expect(messages.map((message) => message.source_id)).toEqual(['REAL']);
  });

  it('hands back the ROWID it read up to, so the next poll starts after it', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...INBOUND, rowid: 10, guid: 'A1' },
        { ...INBOUND, rowid: 11, guid: 'A2' },
      ],
    });

    const result = await sourceFor(file).poll(context());

    expect(result.cursor).toEqual({ rowid: 11 });
  });

  it('resumes after the cursor it is given', async () => {
    const file = fixture({
      chats: CHATS,
      messages: [
        { ...INBOUND, rowid: 10, guid: 'A1' },
        { ...INBOUND, rowid: 11, guid: 'A2' },
      ],
    });

    const result = await sourceFor(file).poll(context({ cursor: { rowid: 10 } }));

    expect(result.messages.map((message) => message.source_id)).toEqual(['A2']);
  });

  it('keeps the cursor where it was when a poll finds nothing new', async () => {
    const file = fixture({ chats: CHATS, messages: [INBOUND] });

    const result = await sourceFor(file).poll(context({ cursor: { rowid: 10 } }));

    expect(result.messages).toEqual([]);
    expect(result.cursor).toEqual({ rowid: 10 });
  });

  it('falls back to the anchor when the cursor is not a shape it wrote', async () => {
    const file = fixture({ chats: CHATS, messages: [INBOUND] });

    const result = await sourceFor(file).poll(context({ cursor: { uidValidity: 7, uid: 3 } }));

    expect(result.messages.map((message) => message.source_id)).toEqual(['11AA-BB']);
  });

  it('claims no owner handles — is_from_me already settles direction', async () => {
    const result = await sourceFor(fixture({ chats: CHATS, messages: [INBOUND] })).poll(context());

    expect(result.ownerHandles).toEqual([]);
  });

  it('fails the poll loudly when the database cannot be opened', async () => {
    const source = sourceFor(path.join(directory, 'gone', 'chat.db'));

    await expect(source.poll(context())).rejects.toThrow(/Full Disk Access/);
  });
});
