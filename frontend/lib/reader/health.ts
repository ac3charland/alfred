import { accountHealth } from '@/lib/comms';
import type {
  CommAccount,
  ReaderHealth,
  ReaderHealthSnapshot,
  ReaderPostListItem,
} from '@/lib/types';

/**
 * What the Reader's health surface is derived from: whether the summariser is working, whether
 * today's model budget is spent, and which single banner — if any — the module owes the owner.
 *
 * Pure, and deliberately clock-free: every function takes the instant to measure against, so a
 * view owns one ticking `now` and hands the same one to the header, the banner and every row.
 * A surface that read the clock per component would draw two different "now"s down its length.
 *
 * The stall rules are the Comms classifier's, transplanted: a backlog draining under a cap is
 * not an outage, and the proof of life is the last summary rather than the absence of errors.
 * The last rule is the Reader's own — past the daily ceiling, posts waiting is the designed
 * behaviour, and a banner calling that a stall would teach the owner to ignore banners. It
 * silences that one signal only: a capped day's ticks still run and still record what fails.
 */

/**
 * How long a claimed post may sit unsummarised before the summariser counts as stalled. Three
 * cadences of the Worker's five-minute tick — well past "the next run will get it".
 */
export const READER_STALL_MINUTES = 15;

/** The tick's own "attempts < 3" retry ceiling. Keep in step with the Worker's summariser. */
export const RETRYABLE_ATTEMPTS = 3;

/** Whether summaries are being produced, have stopped, or have never been produced at all. */
export type SummariserState = 'live' | 'stalled' | 'never';

/**
 * What the stall rules read off the row: the state, when summarising stopped, and the ONE cause
 * the surfaces word that stall with. A union rather than three nullable fields, because a stall
 * always has both a start and a cause — so neither the banner nor the header carries a fallback
 * of its own, which is how the two came to word the same stall differently.
 */
export type SummariserReading =
  // Two members for the two quiet states rather than one with a `'live' | 'never'` state: a
  // member whose discriminant is itself a union survives both narrowings, and the stalled
  // branch then still reads `since` as nullable.
  | { state: 'live'; since: null; cause: null }
  | { state: 'never'; since: null; cause: null }
  | { state: 'stalled'; since: string; cause: string };

/** What a stall with no words of the tick's own is put down to, in the order they are tried. */
const STOPPED_CAUSE = 'the tick has stopped running';
const SILENT_CAUSE = 'no summary has landed since';

const MS_PER_MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MS_PER_MINUTE;

/**
 * The tick's own words for a failure, as it phrased them — or null when it recorded none worth
 * quoting. The trailing terminator goes because the line that quotes this supplies its own.
 */
function recordedWords(error: string | null): string | null {
  const written = error?.trim().replace(/[!.?]+$/, '');
  return written === undefined || written === '' ? null : written;
}

/** The UTC calendar day an instant falls in, in the shape the health row's `calls_day` holds. */
function utcDay(iso: string | Date): string {
  return (typeof iso === 'string' ? new Date(iso) : iso).toISOString().slice(0, 10);
}

/**
 * Has the tick spent today's model budget? Read off the row the Worker writes, never off a
 * constant in here — the cap is a Worker deploy var, and a UI that hard-coded it would lie the
 * day it changes.
 *
 * "Reached" deliberately survives the UTC rollover until the tick has RUN in the new day:
 * between midnight UTC and the first tick, `calls_day` still names yesterday and nothing has
 * reset the count, so the posts sitting pending are waiting by design. Without that clause every
 * capped day would show a false stall from midnight UTC (early evening in Chicago, which is
 * exactly when the list gets read) until the first tick of the new day summarised something.
 *
 * That second clause only BRIDGES midnight: the spent count has to belong to yesterday, so a
 * cron that dies the moment a capped day ends reads as "reached" for that one day and no longer.
 * From the day after, the count is stale rather than current and the stall rules take it over.
 *
 * And "reached" only ever silences the WAITING-POSTS signal in {@link summariserStalled}. A tick
 * on a capped day still runs every five minutes and still records what fails, so a cron that
 * dies over one reads as stalled from its own run age from the moment the window passes —
 * bridging midnight buys the DESIGNED wait a quiet banner, never a dead cron one.
 */
export function ceilingReached(health: ReaderHealth | undefined, now: Date): boolean {
  if (health === undefined) return false;
  const { daily_cap: cap, calls_today: spent, calls_day: day } = health;
  if (cap === null || spent === null || day === null) return false;
  if (spent < cap) return false;

  const today = utcDay(now);
  const yesterday = utcDay(new Date(now.getTime() - DAY_MS));
  const ranToday = health.last_run_at !== null && utcDay(health.last_run_at) === today;
  return day === today || (day === yesterday && !ranToday);
}

/**
 * The claimed posts the tick will still try — and so the ones the ceiling banner counts as
 * "waiting for tomorrow". A post whose text was swept or that never had a body is excluded: the
 * tick files both as failed without a model call, so counting them would report a backlog that
 * nothing is ever going to work through.
 */
export function waitingPosts(posts: ReaderPostListItem[]): ReaderPostListItem[] {
  return posts.filter(
    (post) =>
      post.summary_state === 'pending' &&
      post.summarize_attempts < RETRYABLE_ATTEMPTS &&
      post.text_swept_at === null &&
      post.word_count > 0,
  );
}

/**
 * Has the tick itself stopped running? The Worker fires every five minutes and stamps
 * `last_run_at` as soon as it has cleared pre-flight and counted the day's model calls, so a run
 * older than the stall window is the cron having stopped rather than a slow one — three cadences
 * is well past "the next one will do it".
 *
 * Its own predicate because two surfaces need it: the stall rules take it as a signal, and the
 * header words a stall the tick recorded nothing about ("the tick has stopped running" rather
 * than "no summary has landed since"). A row with no run at all is not this state — nothing has
 * stopped that never started, and {@link summariserStalled} reads that row by its error.
 */
export function tickStopped(health: ReaderHealth | undefined, now: Date): boolean {
  const run = health?.last_run_at ?? null;
  if (run === null) return false;
  // `<=`, as every other comparison against this cutoff is: an instant exactly at the boundary
  // has waited the full window, and the surfaces must not disagree by a millisecond.
  return Date.parse(run) <= now.getTime() - READER_STALL_MINUTES * MS_PER_MINUTE;
}

/**
 * Has summarising stopped, and when did it stop?
 *
 * `never` is the BLANK row and only that: the row the migration seeds with nothing stamped on it
 * yet, or no row at all for a database that predates the seed. A row carrying an error but no
 * run is not blank and not a cron that never fired — the tick stamps its pre-flight failures (an
 * unparsable cap, a missing credential, the ceiling count that precedes the start stamp) BEFORE
 * it records a run, so "no run, an error" is a misconfigured deploy, and the owner is owed the
 * words the tick wrote rather than a shrug at the cron.
 *
 * Then three independent signals, any one sufficient:
 *
 *  1. the tick recorded a systemic failure more recently than a success (a missing binding, a
 *     rejected key) — something it knew about and wrote down;
 *  2. its last run is older than the stall window: the tick stamps a run every five minutes
 *     whether or not it finds work, so a run three cadences old says the cron itself has
 *     stopped, which no queue would ever show on a Reader whose mailbox has gone quiet too; and
 *  3. a claimed post has waited past the cadence while NO post was summarised inside it AND the
 *     tick itself recorded no clean pass inside it, which catches an outage the tick never got
 *     far enough to record. This one alone is suppressed while the daily ceiling is reached,
 *     because then waiting is the designed behaviour — the other two are independent of it.
 *
 * The tick's own proof of life is part of the third signal because a claim is not always fresh:
 * re-summarising a post re-queues a row that keeps its original `created_at`, so a post claimed
 * months ago can be pending a second later. A tick that passed cleanly inside the window is
 * working whatever the claims say — the next one will pick that row up.
 *
 * A waiting post is dated by `created_at` — the instant the tick claimed it — and never by
 * `received_at`, which for a backfilled post is a much older moment and would report an outage
 * dated before the Reader was switched on. And `since` is the EARLIEST signal of the three, so
 * the banner names when summarising actually stopped rather than when the failure was noticed:
 * for the third signal that is the last summary that did land, falling back to the oldest claim
 * when nothing has ever been summarised.
 *
 * `cause` is the one phrase both surfaces word the stall with, and it follows the signals in
 * their own order rather than being re-derived per surface. The tick's own words come first, and
 * ONLY while signal 1 fired: an error a later success has superseded is not what the summariser
 * is stalled on now, and quoting it would blame a key that was rejected this morning for a cron
 * that died at lunchtime. Then the cron itself, when its run has gone missing. Otherwise the
 * silence the waiting posts read — which also covers the tick that recorded a failure and no
 * words for it.
 */
export function summariserStalled(
  health: ReaderHealth | undefined,
  posts: ReaderPostListItem[],
  now: Date,
): SummariserReading {
  // Two statements rather than one condition: the row's absence and its blankness are the same
  // state read off different databases, and either one alone says the cron has never fired.
  if (health === undefined) return { state: 'never', since: null, cause: null };
  if (health.last_run_at === null && health.last_error_at === null) {
    return { state: 'never', since: null, cause: null };
  }

  const signals: string[] = [];
  let recorded: string | null = null;
  let stopped = false;

  if (health.last_error_at !== null) {
    const success = health.last_success_at === null ? null : Date.parse(health.last_success_at);
    if (success === null || Date.parse(health.last_error_at) > success) {
      signals.push(health.last_error_at);
      recorded = recordedWords(health.last_error);
    }
  }

  const run = health.last_run_at;
  if (run !== null && tickStopped(health, now)) {
    signals.push(run);
    stopped = true;
  }

  if (!ceilingReached(health, now)) {
    const cutoff = now.getTime() - READER_STALL_MINUTES * MS_PER_MINUTE;

    let lastSummary: string | undefined;
    for (const post of posts) {
      if (
        post.summarized_at !== null &&
        (lastSummary === undefined || Date.parse(post.summarized_at) > Date.parse(lastSummary))
      ) {
        lastSummary = post.summarized_at;
      }
    }

    let claimedSince: string | undefined;
    for (const post of waitingPosts(posts)) {
      if (Date.parse(post.created_at) > cutoff) continue;
      if (claimedSince === undefined || Date.parse(post.created_at) < Date.parse(claimedSince)) {
        claimedSince = post.created_at;
      }
    }

    const summarisingStill = lastSummary !== undefined && Date.parse(lastSummary) > cutoff;
    const tickPassedInside =
      health.last_success_at !== null && Date.parse(health.last_success_at) > cutoff;
    if (claimedSince !== undefined && !summarisingStill && !tickPassedInside) {
      signals.push(lastSummary ?? claimedSince);
    }
  }

  // Walked rather than sorted: ISO timestamps only compare correctly as strings when they share
  // an offset, and these come from two different writers.
  let since: string | undefined;
  for (const candidate of signals) {
    if (since === undefined || Date.parse(candidate) < Date.parse(since)) since = candidate;
  }

  if (since === undefined) return { state: 'live', since: null, cause: null };
  return { state: 'stalled', since, cause: recorded ?? (stopped ? STOPPED_CAUSE : SILENT_CAUSE) };
}

/** The one banner the module may show, and everything it needs to word itself. */
export type ReaderBanner =
  | { kind: 'gmail'; state: 'stale' | 'erroring'; account: CommAccount }
  /** `cause` is {@link summariserStalled}'s, so the banner and the header name one cause. */
  | { kind: 'stalled'; since: string; cause: string }
  | { kind: 'ceiling'; cap: number; waiting: number };

/**
 * Which banner, if any — one at a time, in a fixed precedence, so the header and the stories
 * cannot disagree about it.
 *
 * A REFUSED mailbox wins outright: it is the one state that needs a person, and nothing new is
 * arriving to summarise or to spend the budget on anyway. A stall comes next, because a
 * summariser that has stopped is a fault where the two states under it are not: a mailbox merely
 * gone quiet loses nothing that has already arrived, and a spent ceiling is the design working.
 * The ceiling is last for the same reason. Three stacked banners would push the list off a phone
 * screen; the header's dots keep the suppressed states visible.
 */
export function readerBanner(
  snapshot: ReaderHealthSnapshot,
  posts: ReaderPostListItem[],
  now: Date,
): ReaderBanner | null {
  const { account, health } = snapshot;
  const gmail = account === undefined ? undefined : accountHealth(account, now);

  if (account !== undefined && gmail === 'erroring') {
    return { kind: 'gmail', state: 'erroring', account };
  }

  const stall = summariserStalled(health, posts, now);
  if (stall.state === 'stalled') {
    return { kind: 'stalled', since: stall.since, cause: stall.cause };
  }

  if (account !== undefined && gmail === 'stale') {
    return { kind: 'gmail', state: 'stale', account };
  }

  const cap = health?.daily_cap ?? null;
  if (cap !== null && ceilingReached(health, now)) {
    return { kind: 'ceiling', cap, waiting: waitingPosts(posts).length };
  }

  return null;
}
