import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { appleNanoseconds, appleSeconds } from './normalize.ts';

/**
 * The only place that speaks chat.db's schema.
 *
 * Everything about this database is undocumented and Apple's to change without notice — the
 * `attributedBody` shift broke every reader in this space once already — so the SQL lives behind
 * one interface and the columns it depends on are asserted at startup, by name. A drift then costs
 * a contained fix and produces a health check that says which column vanished, rather than an
 * empty poll that looks exactly like a quiet week.
 *
 * Two rules hold everywhere in here:
 *
 * - **Read-only, always.** Messages.app holds the write lock and writes constantly under
 *   Messages-in-iCloud; a writable handle risks contention with it for no gain.
 * - **Bigints, not numbers.** `message.date` is nanoseconds since 2001 — around 8·10^17 today,
 *   well past `Number.MAX_SAFE_INTEGER`, which `node:sqlite` refuses to narrow into a JS number.
 *   Statements read integers as `bigint` and the caller narrows what is actually small.
 */

/** How many rows one poll takes. The loop runs every few seconds, so a backlog drains quickly. */
export const MAX_ROWS_PER_POLL = 500;

/**
 * Tapbacks live in `message` like everything else, distinguished only by this range (2000–2005
 * added a reaction, 3000–3005 removed one). They are not messages: a shelf full of "Liked an
 * image" is noise the classifier would have to pay for.
 */
const TAPBACK_RANGE = [2000, 3999] as const;

/** The columns the poller reads, checked at startup so schema drift names itself. */
const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  message: [
    'ROWID',
    'guid',
    'text',
    'attributedBody',
    'date',
    'handle_id',
    'is_from_me',
    'cache_has_attachments',
    'item_type',
    'associated_message_type',
  ],
  handle: ['ROWID', 'id'],
  chat: ['ROWID', 'guid', 'chat_identifier', 'display_name', 'room_name'],
  chat_message_join: ['chat_id', 'message_id'],
  chat_handle_join: ['chat_id', 'handle_id'],
};

export class ChatDbError extends Error {
  override name = 'ChatDbError';
}

export interface ChatDbChat {
  guid?: string;
  identifier?: string;
  displayName?: string;
  /** Group chats carry one; a one-to-one chat does not. */
  roomName?: string;
  /** Raw handle ids of everyone but the owner — chat_handle_join never lists the owner. */
  participants: string[];
}

/** One chat.db row, with its chat resolved but nothing else interpreted. */
export interface ChatDbRow {
  rowid: number;
  guid: string;
  text?: string;
  attributedBody?: Uint8Array;
  /** Raw: nanoseconds since 2001 on current macOS, whole seconds on an older database. */
  date: bigint;
  isFromMe: boolean;
  hasAttachments: boolean;
  handle?: string;
  chat?: ChatDbChat;
}

export interface ReadMessagesInput {
  /** Where the last poll stopped. Absent (or unusable) means read from the anchor instead. */
  cursor?: { rowid: number };
  anchor: Date;
  limit?: number;
}

export interface ChatDb {
  readMessages(input: ReadMessagesInput): ChatDbRow[];
  close(): void;
}

/**
 * Which rows are messages at all. Both `coalesce`s matter: SQL's three-valued logic makes
 * `null not between 2000 and 3999` neither true nor false, so a row with no associated type — most
 * of them — would be dropped by the plain comparison.
 */
const MESSAGE_FILTER = `coalesce(m.associated_message_type, 0) not between ${String(TAPBACK_RANGE[0])} and ${String(TAPBACK_RANGE[1])}
    -- item_type 0 is a message; anything else is a group event (a rename, someone added).
    and coalesce(m.item_type, 0) = 0`;

const SELECT_COLUMNS = `m.ROWID as rowid,
    m.guid as guid,
    m.text as text,
    m.attributedBody as attributed_body,
    m.date as date,
    m.is_from_me as is_from_me,
    h.id as handle,
    (m.cache_has_attachments = 1
      or exists (select 1 from message_attachment_join maj where maj.message_id = m.ROWID))
      as has_attachments,
    (select cmj.chat_id from chat_message_join cmj
      where cmj.message_id = m.ROWID order by cmj.chat_id limit 1) as chat_id`;

/** Forward from the cursor. The date is not consulted at all: ROWID order is ingest order. */
const SELECT_AFTER_CURSOR = `select ${SELECT_COLUMNS}
  from message m
  left join handle h on h.ROWID = m.handle_id
  where m.ROWID > ? and ${MESSAGE_FILTER}
  order by m.ROWID
  limit ?`;

/**
 * First run, or after a cursor was lost: everything since the anchor. The `case` reads both date
 * units — a database restored from an older Mac stores seconds where current macOS stores
 * nanoseconds, and comparing the wrong unit would silently match every row or none.
 */
const SELECT_AFTER_ANCHOR = `select ${SELECT_COLUMNS}
  from message m
  left join handle h on h.ROWID = m.handle_id
  where (case when m.date < ? then m.date > ? else m.date > ? end) and ${MESSAGE_FILTER}
  order by m.ROWID
  limit ?`;

const SELECT_CHAT = `select guid, chat_identifier, display_name, room_name
  from chat where ROWID = ?`;

const SELECT_PARTICIPANTS = `select h.id as handle
  from chat_handle_join chj
  join handle h on h.ROWID = chj.handle_id
  where chj.chat_id = ?
  order by h.id`;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integer(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  return typeof value === 'number' ? BigInt(Math.trunc(value)) : 0n;
}

function bytes(value: unknown): Uint8Array | undefined {
  return value instanceof Uint8Array ? value : undefined;
}

function looksLikePermissionDenied(detail: string): boolean {
  return /operation not permitted|not authorized|authorization denied|permission denied|unable to open|eperm|eacces/i.test(
    detail,
  );
}

const FULL_DISK_ACCESS_FIX =
  'Grant Full Disk Access to the node binary that runs the daemon ' +
  '(System Settings → Privacy & Security → Full Disk Access), then restart it.';

function openFailure(path: string, error: unknown): ChatDbError {
  const detail = error instanceof Error ? error.message : String(error);
  const cause = looksLikePermissionDenied(detail)
    ? `This is what a missing Full Disk Access grant looks like. ${FULL_DISK_ACCESS_FIX}`
    : FULL_DISK_ACCESS_FIX;
  return new ChatDbError(`cannot open ${path} — ${detail}. ${cause}`);
}

function open(path: string): DatabaseSync {
  // A TCC-blocked path is invisible rather than unreadable: without the grant, macOS answers "no
  // such file", so an absent chat.db has to name Full Disk Access too or the real cause is missed.
  if (!existsSync(path)) {
    throw new ChatDbError(
      `cannot see ${path} — either Messages has never run on this Mac, or the daemon cannot see ` +
        `the path at all. ${FULL_DISK_ACCESS_FIX}`,
    );
  }
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw openFailure(path, error);
  }
}

/** The columns the database is actually missing, as `table.column`. */
function missingColumns(database: DatabaseSync): string[] {
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    // The table names are this module's own constants, never input — a pragma takes no parameter.
    const present = new Set(
      database
        .prepare(`pragma table_info(${table})`)
        .all()
        .map((row) => String(row['name']).toLowerCase()),
    );
    if (present.size === 0) {
      missing.push(`${table} (the whole table)`);
      continue;
    }
    for (const column of columns) {
      if (!present.has(column.toLowerCase())) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

function readChat(database: DatabaseSync, chatId: bigint): ChatDbChat | undefined {
  const row = database.prepare(SELECT_CHAT).get(chatId);
  if (row === undefined) return undefined;

  const participants = database
    .prepare(SELECT_PARTICIPANTS)
    .all(chatId)
    .flatMap((participant) => {
      const handle = text(participant['handle']);
      return handle === undefined ? [] : [handle];
    });

  const chat: ChatDbChat = { participants };
  const guid = text(row['guid']);
  if (guid !== undefined) chat.guid = guid;
  const identifier = text(row['chat_identifier']);
  if (identifier !== undefined) chat.identifier = identifier;
  const displayName = text(row['display_name']);
  if (displayName !== undefined) chat.displayName = displayName;
  const roomName = text(row['room_name']);
  if (roomName !== undefined) chat.roomName = roomName;
  return chat;
}

export function openChatDb(path: string): ChatDb {
  const database = open(path);
  /** One chat is read once per poll however many of its messages land in the batch. */
  const chats = new Map<string, ChatDbChat | undefined>();

  function chatFor(chatId: unknown): ChatDbChat | undefined {
    if (typeof chatId !== 'bigint' && typeof chatId !== 'number') return undefined;
    const key = String(chatId);
    if (!chats.has(key)) chats.set(key, readChat(database, BigInt(chatId)));
    return chats.get(key);
  }

  return {
    readMessages(input: ReadMessagesInput): ChatDbRow[] {
      const limit = BigInt(input.limit ?? MAX_ROWS_PER_POLL);
      const statement = database.prepare(
        input.cursor === undefined ? SELECT_AFTER_ANCHOR : SELECT_AFTER_CURSOR,
      );
      statement.setReadBigInts(true);
      const rows =
        input.cursor === undefined
          ? statement.all(
              // The unit probe, then the bound in each unit — see SELECT_AFTER_ANCHOR.
              1_000_000_000_000n,
              appleSeconds(input.anchor),
              appleNanoseconds(input.anchor),
              limit,
            )
          : statement.all(BigInt(input.cursor.rowid), limit);

      return rows.map((row) => {
        const message: ChatDbRow = {
          rowid: Number(integer(row['rowid'])),
          guid: String(row['guid'] ?? ''),
          date: integer(row['date']),
          isFromMe: integer(row['is_from_me']) === 1n,
          hasAttachments: integer(row['has_attachments']) === 1n,
        };
        const body = text(row['text']);
        if (body !== undefined) message.text = body;
        const attributed = bytes(row['attributed_body']);
        if (attributed !== undefined) message.attributedBody = attributed;
        const handle = text(row['handle']);
        if (handle !== undefined) message.handle = handle;
        const chat = chatFor(row['chat_id']);
        if (chat !== undefined) message.chat = chat;
        return message;
      });
    },

    close(): void {
      database.close();
    },
  };
}

/**
 * The startup check: the database opens, the columns we read are still there, and a trivial query
 * returns. A Full Disk Access grant can reset silently across a macOS update, and a daemon that
 * polls an unreadable database looks identical to one watching a quiet phone — so this failure has
 * to be loud and has to say which of the two it is.
 */
export function checkChatDb(path: string): { ok: true } | { ok: false; error: string } {
  let database: DatabaseSync;
  try {
    database = open(path);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const missing = missingColumns(database);
    if (missing.length > 0) {
      return {
        ok: false,
        error:
          `${path} is missing ${missing.join(', ')} — Messages' schema has changed under the ` +
          'daemon and the poller needs updating for this macOS version.',
      };
    }
    database.prepare('select count(*) from message limit 1').get();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: openFailure(path, error).message };
  } finally {
    database.close();
  }
}
