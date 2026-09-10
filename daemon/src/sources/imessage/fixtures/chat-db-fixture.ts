import { DatabaseSync } from 'node:sqlite';

/**
 * Builds a throwaway chat.db holding the subset of Messages' schema the poller reads.
 *
 * The real database is TCC-protected, owned by another process, and full of the owner's private
 * conversations — so no test ever opens it. The column names and types here are copied from a live
 * macOS chat.db, which is what makes a test against this fixture mean anything.
 */

export interface FixtureChat {
  guid: string;
  identifier: string;
  displayName?: string | undefined;
  /** Set on group chats. Its presence is one of the two ways a chat is recognised as a group. */
  roomName?: string | undefined;
  /** Handle ids of everyone but the owner — `chat_handle_join` never lists the owner. */
  participants: string[];
}

export interface FixtureMessage {
  rowid: number;
  guid: string;
  text?: string | undefined;
  attributedBody?: Uint8Array | undefined;
  /** Raw chat.db value: nanoseconds since 2001-01-01 on current macOS, seconds on older ones. */
  date: number | bigint;
  isFromMe?: boolean | undefined;
  /** The sender's handle id. Absent on rows Messages never attributed to anyone. */
  handle?: string | undefined;
  /** The guid of the chat this message belongs to. */
  chat?: string | undefined;
  /** 2000–3999 marks a tapback rather than a message. */
  associatedMessageType?: number | undefined;
  /** Non-zero marks a group-membership event rather than a message. */
  itemType?: number | undefined;
  hasAttachments?: boolean | undefined;
}

export interface FixtureContent {
  chats?: FixtureChat[] | undefined;
  messages: FixtureMessage[];
}

const SCHEMA = [
  `create table handle (
     ROWID integer primary key autoincrement,
     id text not null,
     country text,
     service text,
     uncanonicalized_id text
   )`,
  `create table chat (
     ROWID integer primary key autoincrement,
     guid text unique not null,
     style integer,
     chat_identifier text,
     service_name text,
     room_name text,
     display_name text
   )`,
  `create table message (
     ROWID integer primary key,
     guid text unique not null,
     text text,
     handle_id integer default 0,
     subject text,
     attributedBody blob,
     date integer,
     is_from_me integer default 0,
     cache_has_attachments integer default 0,
     item_type integer default 0,
     associated_message_type integer default 0,
     associated_message_guid text
   )`,
  `create table chat_message_join (
     chat_id integer,
     message_id integer,
     message_date integer default 0,
     primary key (chat_id, message_id)
   )`,
  `create table chat_handle_join (
     chat_id integer,
     handle_id integer,
     unique(chat_id, handle_id)
   )`,
  `create table attachment (
     ROWID integer primary key autoincrement,
     guid text unique not null,
     filename text,
     mime_type text
   )`,
  `create table message_attachment_join (
     message_id integer,
     attachment_id integer,
     unique(message_id, attachment_id)
   )`,
];

type FixtureValue = string | number | bigint | Uint8Array;

/**
 * Inserts a row, naming only the columns that have a value. An absent column takes SQLite's own
 * NULL default, which is how a fixture writes NULL without a `null` literal in TypeScript.
 */
function insertRow(
  database: DatabaseSync,
  table: string,
  values: Record<string, FixtureValue | undefined>,
): number {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, FixtureValue] => entry[1] !== undefined,
  );
  const columns = entries.map(([name]) => name).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = database
    .prepare(`insert into ${table} (${columns}) values (${placeholders})`)
    .run(...entries.map(([, value]) => value));
  return Number(result.lastInsertRowid);
}

export function writeFixtureChatDb(path: string, content: FixtureContent): void {
  const database = new DatabaseSync(path);
  try {
    for (const statement of SCHEMA) database.exec(statement);

    const handleRowIds = new Map<string, number>();
    const handleRowId = (id: string): number => {
      const existing = handleRowIds.get(id);
      if (existing !== undefined) return existing;
      const rowid = insertRow(database, 'handle', { id, service: 'iMessage' });
      handleRowIds.set(id, rowid);
      return rowid;
    };

    const chatRowIds = new Map<string, number>();
    for (const chat of content.chats ?? []) {
      const rowid = insertRow(database, 'chat', {
        guid: chat.guid,
        chat_identifier: chat.identifier,
        room_name: chat.roomName,
        display_name: chat.displayName,
        style: chat.participants.length > 1 ? 43 : 45,
      });
      chatRowIds.set(chat.guid, rowid);
      for (const participant of chat.participants) {
        insertRow(database, 'chat_handle_join', {
          chat_id: rowid,
          handle_id: handleRowId(participant),
        });
      }
    }

    for (const message of content.messages) {
      insertRow(database, 'message', {
        ROWID: message.rowid,
        guid: message.guid,
        text: message.text,
        handle_id: message.handle === undefined ? 0 : handleRowId(message.handle),
        attributedBody: message.attributedBody,
        date: message.date,
        is_from_me: message.isFromMe === true ? 1 : 0,
        cache_has_attachments: message.hasAttachments === true ? 1 : 0,
        item_type: message.itemType ?? 0,
        associated_message_type: message.associatedMessageType ?? 0,
      });
      const chatRowId = message.chat === undefined ? undefined : chatRowIds.get(message.chat);
      if (chatRowId !== undefined) {
        insertRow(database, 'chat_message_join', {
          chat_id: chatRowId,
          message_id: message.rowid,
          message_date: message.date,
        });
      }
    }
  } finally {
    database.close();
  }
}
