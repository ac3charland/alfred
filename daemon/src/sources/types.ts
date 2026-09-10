import type { NormalizedMessage, SourceKey, SourceKind } from '../contract.ts';

/** Everything a source needs to run one poll. Nothing is read from module scope. */
export interface SourceContext {
  /**
   * Where the last poll left off, in whatever shape this source emitted — a chat.db ROWID, an
   * IMAP `{ uidValidity, uid }`. `undefined` on a first run or after the cursor was lost.
   */
  cursor: unknown;
  /**
   * The time to read from when the cursor is unusable: the account's last successful poll, or a
   * seven-day lookback when it has never polled. A fallback, never a floor — see `cursor.ts`.
   */
  anchor: Date;
  now: Date;
  /**
   * Reads a named secret from the macOS keychain. Names are declared in `keychain.ts`
   * (`workmail-imap-password`); a source never sees a secret it did not ask for by name.
   */
  secrets: (name: string) => Promise<string>;
}

export interface PollResult {
  messages: NormalizedMessage[];
  /** The cursor to hand back on the next poll. Reported in the heartbeat either way. */
  cursor: unknown;
  /** The handles that mean "the owner" on this source, as discovered by the poll. */
  ownerHandles: string[];
}

/**
 * One ingestion source. The daemon owns scheduling, batching, signing and retry; a source only
 * answers "am I able to run" and "what is new since this cursor".
 */
export interface Source {
  key: SourceKey;
  kind: SourceKind;
  label: string;
  /** Startup health check. Fails loudly rather than returning an empty poll forever. */
  check(): Promise<{ ok: true } | { ok: false; error: string }>;
  poll(ctx: SourceContext): Promise<PollResult>;
}
