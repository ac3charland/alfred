// Builds a throwaway chat.db holding one conversation, runs the daemon's REAL iMessage source over
// it once, and prints what that poll would POST to the ingest endpoint. The owner's real chat.db
// is never opened.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeFixtureChatDb } from '../../../daemon/src/sources/imessage/fixtures/chat-db-fixture.ts';
import { createIMessageSource } from '../../../daemon/src/sources/imessage/index.ts';

const at = (iso: string): bigint => BigInt(Date.parse(iso) - 978_307_200_000) * 1_000_000n;
const DANA = 'iMessage;-;+13125550100';
const SAM = 'iMessage;-;+13125550199';
const PAT = 'iMessage;-;+13125550142';
const OWNER = { isFromMe: true, handle: undefined };

const rows = [
  [10, DANA, '+13125550100', 'can you send the lease tonight?', '12:00', 0, {}],
  [11, DANA, undefined, 'Loved “can you send the lease tonight?”', '12:03', 2000, OWNER],
  [12, SAM, '+13125550199', 'dinner at 7 still good?', '12:10', 0, {}],
  [13, SAM, undefined, 'Liked “dinner at 7 still good?”', '12:11', 2001, OWNER],
  [14, PAT, '+13125550142', 'you will not believe this', '12:20', 0, {}],
  [15, PAT, undefined, 'Laughed at “you will not believe this”', '12:21', 2003, OWNER],
  [16, PAT, undefined, 'Removed a laugh from “you will not believe this”', '12:22', 3003, OWNER],
  [17, PAT, '+13125550142', 'Loved “Laughed at …”', '12:23', 2000, {}],
] as const;

const directory = mkdtempSync(path.join(tmpdir(), 'alfred-demo-'));
try {
  const file = path.join(directory, 'chat.db');
  writeFixtureChatDb(file, {
    chats: [DANA, SAM, PAT].map((guid) => ({
      guid,
      identifier: guid.split(';').at(-1) ?? guid,
      participants: [guid.split(';').at(-1) ?? guid],
    })),
    messages: rows.map(([rowid, chat, handle, text, time, type, extra]) => ({
      rowid,
      guid: `ROW-${String(rowid)}`,
      chat,
      handle,
      text,
      date: at(`2026-09-01T${time}:00.000Z`),
      associatedMessageType: type,
      ...extra,
    })),
  });

  const source = createIMessageSource(
    { enabled: true, label: 'iMessage' },
    { databasePath: file, contacts: { nameFor: () => undefined } },
  );
  const { messages } = await source.poll({
    cursor: undefined,
    anchor: new Date('2026-08-25T00:00:00.000Z'),
    now: new Date('2026-09-01T13:00:00.000Z'),
    secrets: () => Promise.reject(new Error('no secrets needed')),
  });

  console.log(`chat.db rows: ${String(rows.length)}   messages the poll sends: ${String(messages.length)}\n`);
  for (const message of messages) {
    const time = message.received_at.slice(11, 16);
    console.log(
      `${message.source_id.padEnd(7)} ${time}  ${message.direction.padEnd(8)}  ${message.thread_key.padEnd(24)}  ${message.body}`,
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
