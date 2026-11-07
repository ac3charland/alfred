/**
 * The notify tick: once a minute, claim what just became true — a comms message the model judged
 * ASAP, a timed task whose due minute arrived, the day's morning digest once its time comes — and
 * send each claim to the owner's Telegram chat.
 *
 * A tick is one RPC (`claimNotifications`, which also decides eligibility and abandons dead
 * retries), then per claim one send and one PATCH recording the outcome. Sends go one at a time,
 * in claim order. How a failed send is handled:
 *
 *   sent           stamp sent_at, Telegram's message id and the text.
 *   rate_limited   stop the tick; the claim stays unsent with no attempt counted, so the next tick
 *                  retries it. Telegram's per-chat rate is handled here, not by sleeping.
 *   transient      count the attempt and carry on; the RPC re-returns the claim next tick.
 *   rejected       the same — a 400 that survived the plain-text resend.
 *   systemic       a bad token or chat id, or a chat the bot cannot write to: every later send
 *                  would fail the same way, so stop with a banner and count nothing. Each tick
 *                  until it is fixed still spends one send (and logs the banner) finding that out;
 *                  fixing it within the hour delivers everything claimed meanwhile.
 *
 * Delivery is at most once. Every claim the tick hands back unsent — a counted failure, a rate
 * limit, a systemic stop, or one it never reached — is released, so the next tick retries it. The
 * one claim it never releases is a ping Telegram accepted but whose recording PATCH failed: its
 * lease runs out and the RPC abandons it, rather than send it a second time.
 */
import { DIGEST_BUILD_REQUESTS, type DigestEnv, composeDigest } from '../digest/compose';
import { type TelegramEnv, sendTelegram } from '../telegram';
import { type PingText, buildCommsAsap, buildTaskDue } from './format';
import {
  type NotificationClaim,
  claimNotifications,
  markSent,
  recordFailedAttempt,
  releaseClaims,
} from './store';

/** At most this many claims per tick — far above single-user volume, inside the budget below. */
export const NOTIFY_LIMIT = 20;

/** A claim's attempts before the RPC abandons it. Mirrors `claim_notifications`. */
export const MAX_ATTEMPTS = 3;

/**
 * Outbound fetches one invocation may make on the Workers Free plan. A tick spends 1 on the claim,
 * then 2 per claim (send + PATCH), plus 1 more for each plain-text resend: 1 + 2 × 20 = 41 when
 * nothing is resent. A digest also reads its facts and asks the model (once, plus the SDK's one
 * retry) before its send. A claim only starts when its own worst case — 3, or 6 for a digest —
 * still fits, so a run of resends leaves the rest for the next tick instead of throwing "Too many
 * subrequests" part-way.
 */
export const SUBREQUEST_CEILING = 50;
const WORST_CASE_PER_CLAIM = 3;
export const WORST_CASE_PER_DIGEST = WORST_CASE_PER_CLAIM + DIGEST_BUILD_REQUESTS;
/** Held back from every claim's budget for the one PATCH that releases what the tick left. */
const RELEASE_RESERVE = 1;

/** Logged when DIGEST_TIME is set to something other than `HH:MM`; the other pings carry on. */
export const DIGEST_TIME_INVALID = 'notify: DIGEST_TIME invalid — digest off';

/** Logged when a secret or the app URL is missing: the tick claims nothing while it is off. */
export const UNCONFIGURED = 'notify: telegram unconfigured';

/** Logged when Telegram refuses the bot itself (401/403/404). */
export const SYSTEMIC_FAILURE =
  'notify: aborting the tick — Telegram refused the bot (check the token, and that the chat was started)';

/** Logged when the zone a due time is read in is missing. */
export const CONFIG_FAILURE = 'notify: aborting the tick — CLASSIFIER_TIMEZONE is not set';

/** Everything the tick reads from the environment. */
export interface NotifyEnv extends DigestEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** The app's public origin, for the link each ping carries. A `[vars]` entry. */
  ALFRED_APP_URL?: string;
  /** The IANA zone a task's floating due time is read in — the one the classifier uses. */
  CLASSIFIER_TIMEZONE: string;
  /** When the morning digest goes out, `HH:MM` in that zone. A `[vars]` entry; blank = off. */
  DIGEST_TIME?: string;
}

/** What DIGEST_TIME comes to: the time to claim at, off, or off because it is malformed. */
export type DigestSchedule = { time: string } | { off: 'unset' | 'invalid' };

/** Read DIGEST_TIME: `HH:MM` on a 24-hour clock (`07:00`), else off. */
export function digestSchedule(raw?: string): DigestSchedule {
  const value = raw?.trim() ?? '';
  if (value === '') return { off: 'unset' };
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? { time: value } : { off: 'invalid' };
}

/** What one tick did. `aborted` means it stopped before (or instead of) working the whole claim. */
export interface NotifyTickSummary {
  claimed: number;
  sent: number;
  failed: number;
  /** Failed sends that used a claim's last attempt; the next tick's RPC abandons them. */
  abandoned: number;
  aborted: boolean;
  failures: string[];
}

/** The Telegram bindings and the app URL, or `undefined` when any of the three is missing. */
export function telegramConfig(
  env: Pick<NotifyEnv, 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID' | 'ALFRED_APP_URL'>,
): (TelegramEnv & { appUrl: string }) | undefined {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, ALFRED_APP_URL: appUrl } = env;
  // A blank or whitespace-only value is a missing one, as it is for the Instapaper secrets.
  if (!token?.trim() || !chatId?.trim() || !appUrl?.trim()) return undefined;
  return { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, appUrl };
}

/** A ping claim's text, or `undefined` when the RPC handed back a row missing its fields. */
function textFor(claim: NotificationClaim, appUrl: string): PingText | undefined {
  if (claim.kind === 'comms_asap') {
    const { sender, account, ask } = claim;
    if (sender === null || account === null || ask === null) return undefined;
    return buildCommsAsap({ sender, account, ask }, appUrl);
  }
  const { title, due_time: dueTime } = claim;
  if (title === null || dueTime === null) return undefined;
  return buildTaskDue({ title, dueTime }, appUrl);
}

const summary = (aborted: boolean): NotifyTickSummary => ({
  claimed: 0,
  sent: 0,
  failed: 0,
  abandoned: 0,
  aborted,
  failures: [],
});

/** Run one tick. Resolves only when every send it started has been recorded. */
export async function runNotifyTick(env: NotifyEnv, now: Date): Promise<NotifyTickSummary> {
  // Off until all three are set — checked before the RPC, so nothing is claimed while it is off
  // and nothing expires unsent on the day it is switched on.
  const config = telegramConfig(env);
  if (config === undefined) {
    console.log(UNCONFIGURED);
    return summary(false);
  }

  // `Env` types the zone `string`, but a CLI `--var` can shadow `[vars]` and leave it unset.
  const zone = env.CLASSIFIER_TIMEZONE as string | undefined;
  if (zone === undefined || zone === '') {
    console.error(CONFIG_FAILURE);
    return summary(true);
  }

  // A bad DIGEST_TIME costs the digest, never the other pings.
  const schedule = digestSchedule(env.DIGEST_TIME);
  if ('off' in schedule && schedule.off === 'invalid') console.error(DIGEST_TIME_INVALID);
  const digestTime = 'time' in schedule ? schedule.time : undefined;

  const result = summary(false);
  let claims: NotificationClaim[];
  try {
    claims = await claimNotifications(env, now, zone, NOTIFY_LIMIT, digestTime);
  } catch (error) {
    result.aborted = true;
    result.failures.push(`claim failed: ${message(error)}`);
    return result;
  }
  result.claimed = claims.length;
  let spent = 1;
  /** Claims whose outcome is recorded: sent, or a counted (and released) failure. */
  const settled = new Set<string>();
  /** A claim Telegram accepted whose recording failed: left leased, so it is never resent. */
  let sentUnrecorded: string | undefined;

  try {
    for (const claim of claims) {
      const isDigest = claim.kind === 'morning_digest';
      const worst = isDigest ? WORST_CASE_PER_DIGEST : WORST_CASE_PER_CLAIM;
      if (spent + worst + RELEASE_RESERVE > SUBREQUEST_CEILING) break;

      let text: PingText | undefined;
      if (isDigest) {
        // Rebuilt on every attempt, opener included: `text` records only what was sent.
        try {
          text = await composeDigest(env, now, zone, config.appUrl);
        } catch (error) {
          spent += 2;
          await countFailure(env, claim, `digest facts failed: ${message(error)}`, result);
          settled.add(claim.id);
          continue;
        }
        spent += DIGEST_BUILD_REQUESTS;
      } else {
        text = textFor(claim, config.appUrl);
      }
      if (text === undefined) {
        spent += 1;
        await countFailure(env, claim, 'claim is missing its message fields', result);
        settled.add(claim.id);
        continue;
      }

      const { outcome, requests } = await sendTelegram(config, text.html, text.plain);
      spent += requests;

      if (outcome.kind === 'sent') {
        spent += 1;
        sentUnrecorded = claim.id;
        await markSent(env, claim.id, {
          at: new Date(),
          messageId: outcome.messageId,
          // What Telegram received: the HTML, unless the plain-text resend is what got through.
          text: requests === 2 ? text.plain : text.html,
        });
        sentUnrecorded = undefined;
        settled.add(claim.id);
        result.sent += 1;
        continue;
      }
      if (outcome.kind === 'rate_limited') {
        const wait =
          outcome.retryAfter === undefined ? '' : ` (retry after ${String(outcome.retryAfter)}s)`;
        result.failures.push(`rate limited${wait} — the rest wait for the next tick`);
        break;
      }
      if (outcome.kind === 'systemic') {
        console.error(`${SYSTEMIC_FAILURE}: ${outcome.error}`);
        result.aborted = true;
        result.failures.push(`systemic: ${outcome.error}`);
        break;
      }
      spent += 1;
      await countFailure(env, claim, outcome.error, result);
      settled.add(claim.id);
    }
  } catch (error) {
    // A recording PATCH failed. A ping that went out stays leased (and is abandoned, not resent);
    // everything else unrecorded is released below and retried.
    result.aborted = true;
    result.failures.push(`record failed: ${message(error)}`);
  }

  const unsent = claims.filter((claim) => !settled.has(claim.id) && claim.id !== sentUnrecorded);
  if (unsent.length > 0) {
    try {
      await releaseClaims(
        env,
        unsent.map((claim) => claim.id),
      );
    } catch (error) {
      // Left leased, they are abandoned when the lease runs out: a lost ping, never a double one.
      result.failures.push(`release failed: ${message(error)}`);
    }
  }
  return result;
}

async function countFailure(
  env: NotifyEnv,
  claim: NotificationClaim,
  error: string,
  result: NotifyTickSummary,
): Promise<void> {
  await recordFailedAttempt(env, claim.id, claim.attempts, error);
  result.failed += 1;
  if (claim.attempts + 1 >= MAX_ATTEMPTS) result.abandoned += 1;
  result.failures.push(`${claim.kind} ${claim.id}: ${error}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
