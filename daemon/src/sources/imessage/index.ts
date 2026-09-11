import { homedir } from 'node:os';
import path from 'node:path';

import type { IMessageSourceConfig } from '../../config.ts';
import type { NormalizedMessage } from '../../contract.ts';
import { createLogger } from '../../log.ts';
import type { Logger } from '../../log.ts';
import type { PollResult, Source, SourceContext } from '../types.ts';
import { MAX_ROWS_PER_POLL, checkChatDb, openChatDb } from './chat-db.ts';
import type { ChatDbRow } from './chat-db.ts';
import type { ContactDirectory } from './contacts.ts';
import { createContactDirectory } from './contacts.ts';
import { toNormalizedMessage } from './normalize.ts';

/**
 * iMessage and SMS, read straight off the Mac.
 *
 * There is no cloud API for iMessage, so the only honest read path is the one Messages.app itself
 * writes to: `~/Library/Messages/chat.db`, opened read-only, polled forward on ROWID. Polling
 * rather than watching is deliberate — macOS coalesces filesystem events for a process it thinks
 * is idle, so a watcher stalls for minutes on exactly the quiet machine a firewall has to keep
 * working on.
 *
 * What polling forward cannot see: an edit rewrites a row in place and an unsend blanks one, and
 * neither allocates a new ROWID. So an edited message stays triaged on its original wording and an
 * unsent one persists in alfred's mirror until retention sweeps it. Catching either would mean a
 * full-table diff every poll — throwing away the cursor that makes this cheap — and the message
 * always remains one click away in Messages itself, which is the recovery.
 */

/** The cursor this source emits and reads back: the last ROWID it has ingested. */
export interface IMessageCursor {
  rowid: number;
}

export interface IMessageSourceOptions {
  /** Overridden by tests, which must never open the owner's real chat.db. */
  databasePath?: string;
  contacts?: ContactDirectory;
  /**
   * Where a row that could not be normalized gets reported. Defaults to the real logger (stderr)
   * rather than a no-op, so a skip stays loud in production even though the source registry
   * (`sources/index.ts`, outside this package's ownership) does not wire one in explicitly.
   */
  log?: Logger;
}

export function defaultChatDbPath(home: string = homedir()): string {
  return path.join(home, 'Library', 'Messages', 'chat.db');
}

/**
 * A cursor is only usable if it is the shape this source wrote. Anything else — a restored
 * database, another source's cursor, a hand-edited state file — falls back to the anchor, which
 * re-reads a bounded window rather than reading nothing.
 */
function parseCursor(raw: unknown): IMessageCursor | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const rowid = (raw as Record<string, unknown>)['rowid'];
  if (typeof rowid !== 'number' || !Number.isInteger(rowid) || rowid < 0) return undefined;
  return { rowid };
}

export function createIMessageSource(
  config: IMessageSourceConfig,
  options: IMessageSourceOptions = {},
): Source {
  const databasePath = options.databasePath ?? defaultChatDbPath();
  const contacts = options.contacts ?? createContactDirectory();
  const log = options.log ?? createLogger();

  /**
   * `toNormalizedMessage` throws `UnparseableAppleDateError` for a row whose `message.date` a JS
   * `Date` cannot represent at all — a hand-restored or iCloud-glitched chat.db is the usual
   * cause. Left unguarded (as this call once was), that throw propagates out of the batch's
   * `.map()` and aborts the entire poll: the cursor never advances, so the next tick re-reads the
   * very same poison row and throws again, forever — every message behind it stuck along with it.
   *
   * So this isolates PER ROW: one bad row is skipped rather than taking the batch down with it.
   * A skip is reported LOUDLY, with the row's own ROWID and guid, because a skip nobody can see is
   * exactly the false negative this module's whole design exists to avoid — see the mac-daemon
   * skill. It is deliberately not narrowed to `UnparseableAppleDateError` alone: any unexpected
   * throw from normalizing one row should cost that row, not the rest of the batch.
   */
  function normalizeOrSkip(row: ChatDbRow): NormalizedMessage | undefined {
    try {
      return toNormalizedMessage(row, { nameFor: (handle) => contacts.nameFor(handle) });
    } catch (error) {
      log.error('chat.db row could not be normalized — skipping it', {
        source: 'imessage',
        rowid: row.rowid,
        guid: row.guid,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  function readPoll(ctx: SourceContext): PollResult {
    const cursor = parseCursor(ctx.cursor);
    const database = openChatDb(databasePath);
    try {
      const rows = database.readMessages({
        ...(cursor === undefined ? {} : { cursor }),
        anchor: ctx.anchor,
        limit: MAX_ROWS_PER_POLL,
      });
      const messages = rows.flatMap((row) => {
        const message = normalizeOrSkip(row);
        return message === undefined ? [] : [message];
      });
      const last = rows.at(-1);

      return {
        messages,
        // Derived from every row THIS poll read — including one that was skipped for being
        // unparseable — not only the ones that normalized successfully. A permanently-unparseable
        // row can never become parseable on a later poll, so holding the cursor back on its
        // account would just repeat the same failure forever and silently starve every message
        // behind it. Advancing past it trades one already-logged, already-audited message for
        // keeping the rest of the stream flowing; a poll that found nothing leaves the cursor
        // exactly where it was, and one that read to the cap leaves it at the last row it took, so
        // the next tick picks up the rest.
        cursor: last === undefined ? cursor : { rowid: last.rowid },
        // chat.db records direction on every row (`is_from_me`), and the owner's own handles are
        // not reliably readable, so the server is told to rely on the direction we send.
        ownerHandles: [],
      };
    } finally {
      database.close();
    }
  }

  return {
    key: 'imessage',
    kind: 'imessage',
    label: config.label,

    check(): Promise<{ ok: true } | { ok: false; error: string }> {
      return Promise.resolve(checkChatDb(databasePath));
    },

    poll(ctx: SourceContext): Promise<PollResult> {
      // The read itself is synchronous, but the failure must not be: the runner awaits this call
      // and turns a rejection into an erroring heartbeat, which is how a revoked Full Disk Access
      // grant becomes visible on the health surface instead of taking the daemon down.
      try {
        return Promise.resolve(readPoll(ctx));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
