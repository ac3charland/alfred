/**
 * Where a source resumes from.
 *
 * Two inputs, and they answer different questions. The CURSOR says exactly where the last poll
 * stopped — a chat.db ROWID, an IMAP `(UIDVALIDITY, UID)`. The ANCHOR is the time to read from
 * when the cursor is unusable, which happens more often than it sounds: a UIDVALIDITY change
 * reassigns every IMAP UID, chat.db ROWIDs move on a restore or an iCloud re-sync, and a machine
 * that has never run has neither.
 *
 * The anchor is `lastSeenAt ?? (now − 7 days)` — a FALLBACK, never a maximum. The worked example,
 * because this rule is easy to write backwards: an outage starts on day 7 and is noticed on day
 * 17. The last successful poll was day 7, so the anchor is day 7 and the ten missing days are
 * ingested. `max(lastSeenAt, now − 7d)` would pick the later of the two — day 10 — and days 7–10
 * would never be read at all. `max` selects the window on every outage longer than the window,
 * i.e. in exactly the case that matters.
 *
 * The window is the FIRST-RUN seed and nothing else. After a long outage the catch-up is as large
 * as the outage: that cost is accepted, because an unexpected backfill is recoverable and a
 * silently missing week is not.
 */

/** The first-run lookback. Long enough that nothing live is missed, short enough to be cheap. */
export const DEFAULT_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResumeInput {
  /** The cursor the ingest endpoint last reported. Wins over the local cache on startup. */
  serverCursor?: unknown;
  /** The account's last successful poll, per the ingest endpoint. */
  serverLastSeenAt?: Date;
  /** The local cursor cache — only there to make a restart fast. */
  localCursor?: unknown;
  now: Date;
  lookbackDays?: number;
}

export interface Resume {
  cursor: unknown;
  anchor: Date;
}

export function resumeFrom(input: ResumeInput): Resume {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  return {
    cursor: input.serverCursor ?? input.localCursor,
    anchor: input.serverLastSeenAt ?? new Date(input.now.getTime() - lookbackDays * DAY_MS),
  };
}
