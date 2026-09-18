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
 * The third rule is the Reader's own — past the daily ceiling, posts waiting is the designed
 * behaviour, and a banner calling that a stall would teach the owner to ignore banners.
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

const MS_PER_MINUTE = 60 * 1000;

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
 */
export function ceilingReached(health: ReaderHealth | undefined, now: Date): boolean {
  if (health === undefined) return false;
  const { daily_cap: cap, calls_today: spent, calls_day: day } = health;
  if (cap === null || spent === null || day === null) return false;
  if (spent < cap) return false;

  const today = utcDay(now);
  const ranToday = health.last_run_at !== null && utcDay(health.last_run_at) === today;
  return day === today || !ranToday;
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
 * Has summarising stopped, and when did it stop?
 *
 * No health row at all is `never`, checked before either signal: the tick stamps `last_run_at`
 * before it does anything else, so no row means the cron has never fired — which is a different
 * fault, with a different fix, from a summariser that ran and then stopped.
 *
 * Then two independent signals, either sufficient:
 *
 *  1. the tick recorded a systemic failure more recently than a success (a missing binding, a
 *     rejected key) — something it knew about and wrote down; and
 *  2. a claimed post has waited past the cadence while NO post was summarised inside it, which
 *     catches an outage the tick never got far enough to record. Suppressed while the daily
 *     ceiling is reached, because then waiting is the designed behaviour.
 *
 * A waiting post is dated by `created_at` — the instant the tick claimed it — and never by
 * `received_at`, which for a backfilled post is a much older moment and would report an outage
 * dated before the Reader was switched on. And `since` is the EARLIER of the two signals, so the
 * banner names when summarising actually stopped rather than when the failure was noticed: for
 * the second signal that is the last summary that did land, falling back to the oldest claim
 * when nothing has ever been summarised.
 */
export function summariserStalled(
  health: ReaderHealth | undefined,
  posts: ReaderPostListItem[],
  now: Date,
): { state: SummariserState; since: string | null } {
  if (health === undefined) return { state: 'never', since: null };

  const signals: string[] = [];

  if (health.last_error_at !== null) {
    const success = health.last_success_at === null ? null : Date.parse(health.last_success_at);
    if (success === null || Date.parse(health.last_error_at) > success) {
      signals.push(health.last_error_at);
    }
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
    if (claimedSince !== undefined && !summarisingStill) signals.push(lastSummary ?? claimedSince);
  }

  // Walked rather than sorted: ISO timestamps only compare correctly as strings when they share
  // an offset, and these come from two different writers.
  let since: string | undefined;
  for (const candidate of signals) {
    if (since === undefined || Date.parse(candidate) < Date.parse(since)) since = candidate;
  }

  return since === undefined ? { state: 'live', since: null } : { state: 'stalled', since };
}

/** The one banner the module may show, and everything it needs to word itself. */
export type ReaderBanner =
  | { kind: 'gmail'; state: 'stale' | 'erroring'; account: CommAccount }
  /** `error` is the tick's own words when it recorded any; a stall read off the waiting posts alone has none. */
  | { kind: 'stalled'; since: string; error: string | null }
  | { kind: 'ceiling'; cap: number; waiting: number };

/**
 * Which banner, if any — one at a time, in a fixed precedence, so the header and the stories
 * cannot disagree about it.
 *
 * Gmail dead wins because a mailbox that has stopped delivering makes the other two moot:
 * nothing new is arriving to summarise or to spend the budget on, and it is the one state that
 * needs a person. A stall in turn beats the ceiling, because nothing is being summarised either
 * way and only one of the two is a fault. Three stacked banners would push the list off a phone
 * screen; the header's dots keep the suppressed states visible.
 */
export function readerBanner(
  snapshot: ReaderHealthSnapshot,
  posts: ReaderPostListItem[],
  now: Date,
): ReaderBanner | null {
  const { account, health } = snapshot;

  if (account !== undefined) {
    const gmail = accountHealth(account, now);
    if (gmail !== 'live') return { kind: 'gmail', state: gmail, account };
  }

  const stall = summariserStalled(health, posts, now);
  if (stall.state === 'stalled' && stall.since !== null) {
    return { kind: 'stalled', since: stall.since, error: health?.last_error ?? null };
  }

  if (health?.daily_cap !== undefined && health.daily_cap !== null && ceilingReached(health, now)) {
    return { kind: 'ceiling', cap: health.daily_cap, waiting: waitingPosts(posts).length };
  }

  return null;
}
