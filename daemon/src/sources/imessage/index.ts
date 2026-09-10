import { homedir } from 'node:os';
import path from 'node:path';

import type { IMessageSourceConfig } from '../../config.ts';
import type { PollResult, Source, SourceContext } from '../types.ts';
import { MAX_ROWS_PER_POLL, checkChatDb, openChatDb } from './chat-db.ts';
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

  function readPoll(ctx: SourceContext): PollResult {
    const cursor = parseCursor(ctx.cursor);
    const database = openChatDb(databasePath);
    try {
      const rows = database.readMessages({
        ...(cursor === undefined ? {} : { cursor }),
        anchor: ctx.anchor,
        limit: MAX_ROWS_PER_POLL,
      });
      const messages = rows.map((row) =>
        toNormalizedMessage(row, { nameFor: (handle) => contacts.nameFor(handle) }),
      );
      const last = rows.at(-1);

      return {
        messages,
        // A poll that found nothing leaves the cursor exactly where it was; one that read to the
        // cap leaves it at the last row it took, so the next tick picks up the rest.
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
