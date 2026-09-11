import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { normalizeHandle } from './normalize.ts';

/**
 * Turns `+13125550100` into "Dana Reyes", best effort.
 *
 * chat.db knows handles and nothing else, so a name has to come from the address book: a set of
 * Core Data SQLite stores under `~/Library/Application Support/AddressBook`, one per account plus
 * a local one, behind the same Full Disk Access grant as chat.db.
 *
 * Every failure here is silent by design. A name is a nicety — it makes the shelf readable — while
 * ingestion is the promise. An address book that is missing, unreadable, or on a schema we do not
 * recognise costs the sender's display name and nothing else; it must never be the reason a
 * message fails to arrive.
 */

const ADDRESS_BOOK_SUBPATH = ['Library', 'Application Support', 'AddressBook'] as const;

/** Every account's store carries the same filename; only the directory differs. */
const STORE_FILENAME = 'AddressBook-v22.abcddb';

/** Core Data's own table names. `ZOWNER` points a phone or email row at its record. */
const SELECT_PHONES = `select r.ZFIRSTNAME as first, r.ZLASTNAME as last,
    r.ZORGANIZATION as organization, p.ZFULLNUMBER as handle
  from ZABCDPHONENUMBER p join ZABCDRECORD r on r.Z_PK = p.ZOWNER`;

const SELECT_EMAILS = `select r.ZFIRSTNAME as first, r.ZLASTNAME as last,
    r.ZORGANIZATION as organization, e.ZADDRESS as handle
  from ZABCDEMAILADDRESS e join ZABCDRECORD r on r.Z_PK = e.ZOWNER`;

export interface ContactDirectory {
  /** The display name for a normalised handle, when the address book has one. */
  nameFor(handle: string): string | undefined;
}

export interface ContactDirectoryOptions {
  /** The AddressBook directory. Injected by tests so they never read the owner's contacts. */
  root?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function nameOf(row: Record<string, unknown>): string | undefined {
  const parts = [text(row['first']), text(row['last'])].filter(
    (part): part is string => part !== undefined,
  );
  // A business contact has no personal name at all, and "Riverside Dental" is a better answer on
  // the shelf than a bare phone number.
  return parts.length > 0 ? parts.join(' ') : text(row['organization']);
}

function storePaths(root: string): string[] {
  const stores: string[] = [];
  const local = path.join(root, STORE_FILENAME);
  if (existsSync(local)) stores.push(local);

  try {
    const sources = path.join(root, 'Sources');
    for (const entry of readdirSync(sources, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const store = path.join(sources, entry.name, STORE_FILENAME);
      if (existsSync(store)) stores.push(store);
    }
  } catch {
    // No Sources directory, or no permission to list it: whatever local store we found still counts.
  }
  return stores;
}

function readStore(store: string, into: Map<string, string>): void {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(store, { readOnly: true });
    // Same reasoning as chat-db.ts's open(): sqlite's default busy_timeout is 0, so a read racing
    // a writer's lock fails instantly rather than waiting briefly. That matters more here — the
    // address book is read once and cached for the life of the process (see
    // createContactDirectory below), so an unlucky transient lock at that one moment would
    // otherwise cost every sender name until the daemon restarts, not just one poll.
    database.exec('pragma busy_timeout = 2000');
  } catch {
    return;
  }

  try {
    for (const query of [SELECT_PHONES, SELECT_EMAILS]) {
      let rows: Record<string, unknown>[];
      try {
        rows = database.prepare(query).all();
      } catch {
        // This store is on a schema we do not know. The next one may not be.
        continue;
      }
      for (const row of rows) {
        // Normalised the same way the poller normalises a sender, or the two never meet.
        const handle = normalizeHandle(text(row['handle']));
        const name = nameOf(row);
        if (handle !== undefined && name !== undefined && !into.has(handle)) {
          into.set(handle, name);
        }
      }
    }
  } finally {
    database.close();
  }
}

export function defaultAddressBookRoot(home: string = homedir()): string {
  return path.join(home, ...ADDRESS_BOOK_SUBPATH);
}

/**
 * Reads every store once, on the first lookup, and answers from memory after that. The address
 * book is small, the daemon is long-lived, and re-reading it every poll would spend the whole
 * budget on a database that changes a few times a year.
 */
export function createContactDirectory(options: ContactDirectoryOptions = {}): ContactDirectory {
  const root = options.root ?? defaultAddressBookRoot();
  let names: Map<string, string> | undefined;

  return {
    nameFor(handle: string): string | undefined {
      if (names === undefined) {
        names = new Map<string, string>();
        for (const store of storePaths(root)) readStore(store, names);
      }
      return names.get(handle);
    },
  };
}
