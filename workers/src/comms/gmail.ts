/**
 * Polling the two Gmail accounts from the Worker's own cron.
 *
 * Gmail is the one source alfred can reach without the Mac: it has a real API, so it rides the
 * Worker's schedule and is the only part of the module whose freshness does not depend on a laptop
 * being awake. Those two accounts therefore carry the whole latency promise, which is why so much
 * of what follows is about noticing when one of them has quietly stopped working.
 *
 * The shape of one account's poll: register the account, mint an access token from its stored
 * refresh token, ask Gmail where the mailbox stands, work out what has arrived since last time,
 * read those messages, normalise them, store them, and stamp the poll. Each account runs
 * SEQUENTIALLY and in its OWN try/catch, because a revoked token on one is not a reason for the
 * other to go dark — and a total across both would hide exactly that.
 *
 * Three rules run through it that are easy to get backwards:
 *
 * The account is registered BEFORE anything can fail. An account whose token was revoked months
 * ago must still appear in the health strip wearing a red dot; one that never registers is simply
 * absent, which reads as "not set up" rather than "broken".
 *
 * The cursor advances only on a clean pass. A message read that fails on transport stops this
 * account for this tick with whatever it managed to store, and leaves the cursor exactly where it
 * was — so the next tick re-reads the same stretch of history and the insert dedupes. Advancing
 * past an unread message would be a silent false negative, which is the one failure this module
 * exists to prevent.
 *
 * Newsletters are stored and then shelved, never dropped. The filter shelves them with a flag
 * saying the FILTER and not the model put them there; because the tier is already set, the
 * classifier's worklist never sees them, which is the whole saving.
 *
 * A truncated listing (more than `MAX_MESSAGE_IDS` matches — a first run or a re-seed over a busy
 * week) must not stamp the cursor at the mailbox's current head: that head is "now", and a history
 * walk only ever sees changes AFTER the historyId it starts from, so anything still unlisted below
 * the cap would never be looked at again. `planFetch` instead freezes the search window it used
 * (`listAfter`/`listBefore` on the stored cursor) and repeats it, tick after tick. Once a pass
 * comes back un-truncated the whole window is drained, and the cursor promotes to
 * `resumeHistoryId` — the mailbox's historyId from the moment the catch-up BEGAN, not this tick's
 * own — so the history walk that follows still covers everything that arrived while the catch-up
 * was in progress. A truncated history walk (the steady-state path, not a catch-up) needs none of
 * this: `listHistory` in `gmail-api.ts` already reports the last history record it safely
 * consumed, and that IS a valid `startHistoryId` to resume from.
 *
 * Narrowing `listBefore` to the oldest message actually read each tick used to be the ONLY way a
 * catch-up made progress — safe-looking because both edges of a frozen window are already in the
 * past, so narrowing can never skip a message that arrives later. It is not, on its own, enough:
 * Gmail's `before:`/`after:` operators resolve only to whole SECONDS and are INCLUSIVE, so once
 * `MAX_MESSAGE_IDS` or more unread messages share one exact trailing second, no amount of further
 * narrowing can ever exclude them — the identical query returns the identical set forever, and a
 * livelock that stamps no error looks, from the outside, exactly like a healthy quiet mailbox.
 * `finalizeListingCursor` therefore prefers Gmail's OWN resumption token for the listing (see
 * `GmailMessageList.pageToken` in `gmail-api.ts`) whenever Gmail hands one back: pagination is
 * independent of the search's date granularity, so it pages straight through a tied second the
 * same as it would any other page boundary. Date narrowing survives only as the fallback for the
 * pathological case where Gmail did not provide a token (a single response page already past the
 * cap, which a real `maxResults`-respecting response should not produce) — and even there,
 * `finalizeListingCursor` now detects a narrowing that made no real progress and reports it so
 * `pollAccount` can surface the account as erroring rather than loop on it silently.
 *
 * `resumeHistoryId` is itself not risk-free across a long catch-up: it is frozen once, at the tick
 * the catch-up began, and only used once the window fully drains — which can be many ticks later
 * if the mailbox is busy. Gmail's own historyId is good for roughly a week; if the catch-up
 * outlives that, the frozen id has expired by the time anything tries to use it, and `planFetch`
 * falls back to `reseedFrom`. That fallback normally anchors on the account's `last_seen_at` — a
 * fine anchor for an ordinary steady-state history walk, since `last_seen_at` there really does
 * mean "the last time this account made progress". But `recordPollSuccess` stamps `last_seen_at`
 * on EVERY successful tick, including every still-truncated one — so by the time a long catch-up's
 * `resumeHistoryId` finally gets tried, `last_seen_at` means "last tick", not "when the catch-up
 * began", and reseeding from it would silently discard everything the frozen id existed to
 * protect. The stored cursor therefore carries the catch-up's own `resumeAnchor` — a copy of the
 * window's original `listAfter` — alongside the promoted `resumeHistoryId`, and drops it again the
 * first time that historyId is used successfully. `reseedFrom` prefers this anchor over
 * `last_seen_at` whenever one is present, so a reseed after an expired catch-up id lands back at
 * the true start of the backlog it was protecting, not at "roughly whenever the last tick ran".
 */
import { type SupabaseEnv } from '../supabase';
import {
  extractText,
  headerValue,
  parseAddress,
  parseAddressList,
  parseMessageIdList,
} from './email-text';
import {
  type GmailClient,
  type GmailFailure,
  type GmailMessage,
  type GmailProfile,
  gmailClient,
} from './gmail-api';
import { fetchAccessToken } from './gmail-oauth';
import { fetchMessageIdsBySourceIds } from './gmail-store';
import { hasListHeaderSignal, isNewsletter } from './newsletter';
import {
  fetchPeople,
  ingestMessages,
  patchMessage,
  recordPollError,
  recordPollSuccess,
  upsertAccount,
} from './store';
import type { AccountUpsert, NormalizedMessage } from './types';

/** The database, plus the OAuth client and one refresh token per Gmail account. */
export interface GmailEnv extends SupabaseEnv {
  GMAIL_OAUTH_CLIENT_ID?: string;
  GMAIL_OAUTH_CLIENT_SECRET?: string;
  GMAIL_PERSONAL_REFRESH_TOKEN?: string;
  GMAIL_REALPLAY_REFRESH_TOKEN?: string;
}

/** What one account's poll did. `polled: false` with an error is a dead account, not a quiet one. */
export interface GmailAccountPoll {
  key: string;
  polled: boolean;
  /** Rows the database had not already seen. A re-seed is nearly all duplicates and no harm. */
  accepted: number;
  error?: string | undefined;
}

/** What one pass over every Gmail account did. */
export interface GmailPollSummary {
  accounts: GmailAccountPoll[];
}

/** One Gmail account: its stable key, its display label, and the secret holding its token. */
interface AccountSpec {
  key: string;
  label: string;
  binding: 'GMAIL_PERSONAL_REFRESH_TOKEN' | 'GMAIL_REALPLAY_REFRESH_TOKEN';
}

/**
 * The two accounts, fixed here rather than configured. There are exactly two, their secrets are
 * set by hand, and a table in the database would only be a second place for the same three
 * strings to disagree with wrangler.toml.
 */
const ACCOUNTS: readonly AccountSpec[] = [
  { key: 'gmail-personal', label: 'personal', binding: 'GMAIL_PERSONAL_REFRESH_TOKEN' },
  { key: 'gmail-realplay', label: 'RealPlay', binding: 'GMAIL_REALPLAY_REFRESH_TOKEN' },
];

/** How long without a successful poll counts as stale here. Gmail rides the cron; minutes matter. */
export const GMAIL_INTERVAL_SECONDS = 600;

/** The first-run window. Anything older than this is never ingested, on any account. */
export const LOOKBACK_DAYS = 7;

/** The Gmail search that expresses that window on a first run. */
export const FIRST_RUN_QUERY = `newer_than:${String(LOOKBACK_DAYS)}d`;

/** What an account with no refresh token reports. Unconfigured is not broken. */
export const NOT_CONFIGURED = 'not configured';

/** What a dead refresh token reports. Only a human can fix it, so it says so. */
export const REJECTED_TOKEN = 'refresh token rejected — re-authorize';

/**
 * What a truncated listing catch-up reports when it can no longer tell whether it is making
 * progress. This is the fallback safety net, not the normal outcome — see the module doc's
 * discussion of `finalizeListingCursor`'s page-token vs. date-narrowing paths. A silent stall is
 * the one failure this module least affords: the account must go visibly red rather than
 * plateau forever with no symptom at all.
 */
export const LISTING_STALLED =
  'gmail listing catch-up made no forward progress — too many messages share one search-boundary second to narrow past; needs a person to look';

/** Labels that mean the message never arrived in any sense the owner would recognise. */
const SKIPPED_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT']);

/** Gmail's marker for the owner's own outgoing mail — the message that drains a thread. */
const SENT_LABEL = 'SENT';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The furthest either direction a JavaScript `Date` will go before it refuses to be one. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/** How much of the account each poll registers. Health and cursor are written by their own calls. */
function registration(spec: AccountSpec): AccountUpsert {
  return {
    key: spec.key,
    kind: 'gmail',
    label: spec.label,
    home: 'worker',
    expected_interval_seconds: GMAIL_INTERVAL_SECONDS,
  };
}

/**
 * Poll every configured Gmail account. Reports per account rather than in aggregate, because a
 * revoked token on one account is invisible in a total that the other account keeps healthy.
 */
export async function pollGmail(env: GmailEnv, now: Date): Promise<GmailPollSummary> {
  const accounts: GmailAccountPoll[] = [];
  // Read once per tick and shared by both accounts — it is the same people either way, and the
  // filter consults it for every inbound message. Read LAZILY, and inside the try below, for two
  // reasons: a deploy still waiting on its secrets should cost no query at all, and a database
  // that refuses should show up against the account being polled rather than take down the tick.
  let rosterHandles: Set<string> | undefined;

  // Sequential rather than concurrent: two accounts is never enough work for the interleaving to
  // pay, and one at a time keeps the Gmail quota and the log readable.
  for (const spec of ACCOUNTS) {
    const refreshToken = env[spec.binding] ?? '';
    // An account whose secret was never set is not a broken account. It reports itself as
    // unconfigured and registers nothing, so the health strip shows only the accounts that exist.
    if (refreshToken === '') {
      accounts.push({ ...emptyPoll(spec), error: NOT_CONFIGURED });
      continue;
    }

    try {
      rosterHandles ??= await emailHandles(env);
      accounts.push(await pollAccount(env, spec, refreshToken, rosterHandles, now));
    } catch (error) {
      // Nothing is stamped on the account here. What lands in this catch is almost always the
      // database itself refusing, and a second write to record that would fail the same way.
      accounts.push({ ...emptyPoll(spec), error: describe(error) });
    }
  }
  return { accounts };
}

/** Every email address on the roster, lower-cased — what the newsletter filter checks against. */
async function emailHandles(env: GmailEnv): Promise<Set<string>> {
  const people = await fetchPeople(env);
  const handles = new Set<string>();
  for (const person of people) {
    for (const handle of person.handles) {
      if (handle.kind === 'email') handles.add(handle.handle.toLowerCase());
    }
  }
  return handles;
}

/** What a poll that never got started reports. */
function emptyPoll(spec: AccountSpec): GmailAccountPoll {
  return { key: spec.key, polled: false, accepted: 0 };
}

/** Whatever was thrown, as a line worth recording. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A Gmail failure as a health message, keeping the "a human must act" distinction visible. */
function apiError(failure: GmailFailure): string {
  return failure.reason === 'rejected'
    ? `gmail refused the request — re-authorize (token or scope): ${failure.detail}`
    : `gmail request failed: ${failure.detail}`;
}

/** Stamp a failed poll and report it. Never touches `last_seen_at` or the cursor. */
async function failed(
  env: GmailEnv,
  accountId: string,
  spec: AccountSpec,
  now: Date,
  error: string,
  accepted = 0,
): Promise<GmailAccountPoll> {
  await recordPollError(env, accountId, { at: now, error });
  return { key: spec.key, polled: false, accepted, error };
}

/** Which half of the shared OAuth client is missing, if either is. */
function missingOAuthBinding(env: GmailEnv): string | undefined {
  if ((env.GMAIL_OAUTH_CLIENT_ID ?? '') === '') return 'GMAIL_OAUTH_CLIENT_ID';
  if ((env.GMAIL_OAUTH_CLIENT_SECRET ?? '') === '') return 'GMAIL_OAUTH_CLIENT_SECRET';
  return undefined;
}

/**
 * The frozen window of a listing catch-up still in progress — see the module doc's fourth rule.
 * `listAfter` and `resumeHistoryId` never change once set. `listBefore` and `pageToken` are this
 * TICK's own values (as read from the stored cursor before this fetch ran), which
 * `finalizeListingCursor` needs to decide how to advance them for next time.
 */
interface TruncatedListingWindow {
  /** ISO — the search window's lower bound, fixed the moment a listing first overflows the cap. */
  listAfter: string;
  /** The mailbox's historyId as of the tick the catch-up began — promoted to the real cursor once
   *  the window is fully drained. */
  resumeHistoryId: string;
  /** This tick's own upper bound (undefined on the very first truncated tick), i.e. what this
   *  tick's query actually used — needed to tell whether narrowing it further made any progress. */
  listBefore: string | undefined;
  /** Gmail's own resumption point for this exact listing, when this tick's fetch got one back.
   *  Once set, it — not date narrowing — is what carries the catch-up forward; see the module
   *  doc and `finalizeListingCursor` below. */
  pageToken: string | undefined;
}

/**
 * What this poll should read, and where the cursor lands once it has.
 *
 * Two shapes. Most ticks resolve the next cursor outright (a history walk — truncated or not, see
 * `listHistory` — or a listing that fit under the cap): `cursor` is exactly what `recordPollSuccess`
 * should write. A listing that DID overflow cannot be resolved yet — the safe upper bound for next
 * time depends on which messages this tick actually manages to read, known only after the fetch
 * loop below — so it hands back the frozen window instead and `pollAccount` finishes the job.
 */
type FetchPlan =
  | { sourceIds: string[]; cursor: unknown }
  | { sourceIds: string[]; truncatedListing: TruncatedListingWindow };

/** Poll one account, from registration through to the health stamp. */
async function pollAccount(
  env: GmailEnv,
  spec: AccountSpec,
  refreshToken: string,
  rosterHandles: Set<string>,
  now: Date,
): Promise<GmailAccountPoll> {
  // Registered before anything can fail, so an account that cannot be polled at all still shows
  // up wearing whatever error stopped it.
  const registered = await upsertAccount(env, registration(spec));

  const missingBinding = missingOAuthBinding(env);
  if (missingBinding !== undefined) {
    return failed(env, registered.id, spec, now, `${missingBinding} is not set`);
  }

  const access = await fetchAccessToken(
    {
      GMAIL_OAUTH_CLIENT_ID: env.GMAIL_OAUTH_CLIENT_ID ?? '',
      GMAIL_OAUTH_CLIENT_SECRET: env.GMAIL_OAUTH_CLIENT_SECRET ?? '',
    },
    refreshToken,
  );
  if (!access.ok) {
    const error =
      access.reason === 'rejected'
        ? REJECTED_TOKEN
        : `gmail token exchange failed: ${access.detail}`;
    return failed(env, registered.id, spec, now, error);
  }

  const client = gmailClient(access.token);

  const profile = await client.getProfile();
  if (!profile.ok) return failed(env, registered.id, spec, now, apiError(profile));

  // Re-registered with the address the token actually belongs to. The store compares a sender
  // against these to decide direction, so the owner's own replies never land in the queue — and
  // reading the address from the profile means nobody has to keep it in a config file in step
  // with which mailbox the token opens.
  const account = await upsertAccount(env, {
    ...registration(spec),
    owner_handles: [profile.value.emailAddress.toLowerCase()],
  });

  const plan = await planFetch(client, account.cursor, account.last_seen_at, profile.value, now);
  if ('error' in plan) return failed(env, account.id, spec, now, plan.error);

  const ownerHandles = new Set(account.owner_handles.map((handle) => handle.toLowerCase()));
  const messages: NormalizedMessage[] = [];
  const shelve: string[] = [];
  // Every message this tick actually got back from Gmail, regardless of whether it was later
  // skipped as spam or a draft — a truncated listing's cursor narrows against this, not against
  // `messages`, since a skipped id has still been looked at and need not be re-listed.
  const readAt: string[] = [];
  let stalled: string | undefined;

  // Sequential, and it stops at the first read that might succeed later: the cursor has not moved
  // yet, so stopping loses nothing while pressing on past a gap would.
  for (const sourceId of plan.sourceIds) {
    const fetched = await client.getMessage(sourceId);
    if (!fetched.ok) {
      // Gone between the listing and the read — permanently deleted, with nothing left to store.
      // Skipped rather than treated as a stall, or the cursor would wedge on it forever.
      if (fetched.status === 404) continue;
      stalled = apiError(fetched);
      break;
    }

    const message = fetched.value;
    readAt.push(receivedAt(message.internalDate, now));
    const labels = message.labelIds ?? [];
    if (labels.some((label) => SKIPPED_LABELS.has(label))) continue;

    const normalized = normalize(message, now);
    messages.push(normalized);

    if (
      normalized.direction === 'inbound' &&
      !ownerHandles.has(normalized.sender_handle) &&
      isNewsletter(message.payload?.headers, {
        senderHandle: normalized.sender_handle,
        rosterHandles,
      })
    ) {
      shelve.push(normalized.source_id);
    }
  }

  // Stored even when the read stalled part-way: the rows are good, the insert dedupes, and an
  // outbound message among them should drain its thread whether or not the tick finished.
  const result = await ingestMessages(env, account, messages, now);
  await shelveNewsletters(env, account.id, shelve, now);

  if (stalled !== undefined) {
    return failed(env, account.id, spec, now, stalled, result.accepted);
  }

  if ('cursor' in plan) {
    await recordPollSuccess(env, account.id, { at: now, cursor: plan.cursor });
    return { key: spec.key, polled: true, accepted: result.accepted };
  }

  const finalized = finalizeListingCursor(plan.truncatedListing, readAt);
  if (finalized.stalled) {
    // The cursor is deliberately left untouched (`failed` never writes one) — the tied messages
    // are still there and still unread, so the next external retry gets exactly this same window
    // to try again, rather than this tick inventing a worse guess.
    return failed(env, account.id, spec, now, LISTING_STALLED, result.accepted);
  }
  await recordPollSuccess(env, account.id, { at: now, cursor: finalized.cursor });
  return { key: spec.key, polled: true, accepted: result.accepted };
}

/** The parts of a stored cursor this module reads. Anything malformed reads as absent. */
interface StoredCursor {
  historyId?: string | undefined;
  listAfter?: string | undefined;
  listBefore?: string | undefined;
  resumeHistoryId?: string | undefined;
  /** Gmail's own resumption point for the listing still in progress — see `TruncatedListingWindow`
   *  and `finalizeListingCursor`. */
  pageToken?: string | undefined;
  /** The catch-up's original `listAfter`, carried alongside a promoted `resumeHistoryId` until
   *  that id has been used at least once successfully — see the module doc's discussion of
   *  `reseedFrom` and the "wrong anchor" bug it exists to close. */
  resumeAnchor?: string | undefined;
}

/** A cursor field as a non-empty string, or absent — anything else reads as "not set". */
function asStoredString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The stored cursor's fields, individually — a bad or missing one reads as "not set". */
function readCursor(cursor: unknown): StoredCursor {
  const raw = cursor as
    | {
        historyId?: unknown;
        listAfter?: unknown;
        listBefore?: unknown;
        resumeHistoryId?: unknown;
        pageToken?: unknown;
        resumeAnchor?: unknown;
      }
    | undefined;
  return {
    historyId: asStoredString(raw?.historyId),
    listAfter: asStoredString(raw?.listAfter),
    listBefore: asStoredString(raw?.listBefore),
    resumeHistoryId: asStoredString(raw?.resumeHistoryId),
    pageToken: asStoredString(raw?.pageToken),
    resumeAnchor: asStoredString(raw?.resumeAnchor),
  };
}

/**
 * What to read this tick, and the cursor that follows it.
 *
 * Three paths. A history walk from the stored cursor is the normal one and the only cheap one; a
 * first run with no cursor at all, and a re-seed when Gmail no longer recognises the cursor it
 * was given, both fall back to a dated search and differ only in the date they start from. A
 * fourth state — `listAfter` on the stored cursor — is not a fourth PATH so much as a hold on the
 * second and third: it means the previous tick's listing overflowed the cap and the catch-up is
 * still draining its frozen window, so this tick keeps listing rather than switching to a walk.
 */
async function planFetch(
  client: GmailClient,
  cursorRaw: unknown,
  lastSeenAt: string | undefined,
  profile: GmailProfile,
  now: Date,
): Promise<FetchPlan | { error: string }> {
  const cursor = readCursor(cursorRaw);

  // A history walk is only safe once any listing catch-up has fully drained its window (see the
  // module doc's fourth rule) — `listAfter` being set means it has not.
  if (cursor.listAfter === undefined && cursor.historyId !== undefined) {
    const history = await client.listHistory({ startHistoryId: cursor.historyId });
    if (!history.ok) return { error: apiError(history) };
    if (!history.value.expired) {
      return {
        sourceIds: history.value.messageIds,
        cursor: {
          // Not truncated: Gmail's own answer for where the mailbox now stands (or the profile's,
          // on an empty walk — the same answer read a moment earlier). Truncated: `listHistory`
          // has already resolved this to the last history record it safely consumed, which is a
          // valid `startHistoryId` in its own right — falling back to the cursor we walked FROM
          // only in the pathological case where no such record exists at all (see that module).
          historyId: history.value.truncated
            ? (history.value.historyId ?? cursor.historyId)
            : (history.value.historyId ?? profile.historyId),
          // `resumeAnchor` deliberately dropped here even if `cursor` carried one in: this
          // historyId has just been proven good, so whatever catch-up minted it no longer needs
          // its original window remembered (see the module doc and `reseedFrom` below).
        },
      };
    }
    // Expired: fall through to a fresh listing pass, exactly like a first run — but see
    // `reseedFrom` below for why the date it anchors on is not simply `lastSeenAt`.
  }

  // `cursor.listAfter`, when set, is the frozen lower bound of a listing catch-up already in
  // progress — reused verbatim, never recomputed, so a multi-tick catch-up keeps making progress
  // on the same range instead of one whose "now"-relative start has quietly drifted forward.
  const after =
    cursor.listAfter === undefined
      ? cursor.historyId === undefined
        ? undefined // a genuine first run — FIRST_RUN_QUERY already expresses the 7-day window
        : reseedFrom(cursor.resumeAnchor ?? lastSeenAt, now)
      : new Date(cursor.listAfter);
  const before = cursor.listAfter === undefined ? undefined : parseIsoDate(cursor.listBefore);

  const listed = await client.listMessageIds({
    q: buildListQuery(after, before),
    // Resumes the EXACT listing this tick already had a token for — see `GmailMessageList.pageToken`
    // and the module doc. `undefined` on any tick that never got one is simply "start this query
    // from the top", identical to today's behaviour.
    pageToken: cursor.pageToken,
  });
  if (!listed.ok) return { error: apiError(listed) };

  // The same expression either way: the historyId frozen when a catch-up began, or — when there
  // was none — this tick's own profile, which is exactly what "no catch-up in progress" means.
  const resumeHistoryId = cursor.resumeHistoryId ?? profile.historyId;

  if (!listed.value.truncated) {
    // The window — whichever one this pass covered — is now fully drained. Safe to start walking
    // history from here.
    const promoted: Record<string, string> = { historyId: resumeHistoryId };
    // Only a genuine catch-up (one that had a frozen `listAfter`) needs its window remembered —
    // a small first run that never truncated has nothing to protect.
    if (cursor.listAfter !== undefined) promoted['resumeAnchor'] = cursor.listAfter;
    return { sourceIds: listed.value.ids, cursor: promoted };
  }

  return {
    sourceIds: listed.value.ids,
    truncatedListing: {
      listAfter: (after ?? new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)).toISOString(),
      resumeHistoryId,
      listBefore: cursor.listBefore,
      pageToken: listed.value.pageToken,
    },
  };
}

/** Build the search Gmail should run for a (possibly window-bounded) listing pass. */
function buildListQuery(after: Date | undefined, before: Date | undefined): string {
  const base = after === undefined ? FIRST_RUN_QUERY : `after:${unixSeconds(after)}`;
  return before === undefined ? base : `${base} before:${unixSeconds(before)}`;
}

function parseIsoDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

/**
 * The cursor to store once a truncated listing's fetch loop has run, and whether the window made
 * any real forward progress this tick.
 *
 * PRIMARY mechanism: Gmail's own resumption token for this exact listing (`window.pageToken`,
 * threaded through from `GmailMessageList.pageToken` — see `gmail-api.ts`). When Gmail handed one
 * back, it — not any date bound — is what carries the catch-up forward next tick: Gmail's own
 * pagination has no dependency on the search's date granularity, so it pages straight through a
 * tied second exactly as it would any other boundary. `listAfter`/`listBefore` are frozen verbatim
 * alongside it (never renarrowed) because a token only resumes the IDENTICAL query it came from —
 * changing the query out from under it would invalidate it.
 *
 * FALLBACK: only when Gmail did not hand back a token (the pathological case of a single response
 * page already past `MAX_MESSAGE_IDS` — a real `maxResults`-respecting response should not produce
 * this) does the window narrow by date instead, to the oldest message actually read this tick
 * (regardless of whether it was later skipped as spam or a draft — anything Gmail handed back has
 * been looked at and need not be re-listed). Narrowing this way can never SKIP a message:
 * `listAfter` and the window's upper edge are both already in the past, so nothing new can ever
 * arrive "inside" a range that is entirely history. It can, however, fail to ADVANCE: Gmail's
 * `before:`/`after:` operators resolve only to whole SECONDS and are INCLUSIVE, so once
 * `MAX_MESSAGE_IDS` or more still-unread messages share the exact trailing second `listBefore` is
 * already sitting at, no amount of further narrowing can ever exclude them — the identical query
 * returns the identical set forever. `stalled` reports exactly that: this tick's own narrowed
 * bound, floored to the second Gmail's query actually operates at, came out identical to the bound
 * this tick's own query already used. `pollAccount` turns that into a visible error rather than a
 * silent repeat.
 *
 * If nothing in this batch could be read at all (every id 404'd — gone before the read reached
 * it), there is no new timestamp to narrow with, so the PRIOR bound is kept rather than dropped —
 * Gmail's own index no longer lists what is already confirmed gone, so the window need not widen
 * for the next identical query to still make progress elsewhere in it. That reasoning is specific
 * to messages that are actually GONE; it does not extend to the tied-second case above, where the
 * messages are very much still there and simply indistinguishable from already-read ones at
 * second granularity.
 */
function finalizeListingCursor(
  window: TruncatedListingWindow,
  readAt: string[],
): { cursor: unknown; stalled: boolean } {
  const cursor: Record<string, string> = {
    listAfter: window.listAfter,
    resumeHistoryId: window.resumeHistoryId,
  };

  if (window.pageToken !== undefined) {
    if (window.listBefore !== undefined) cursor['listBefore'] = window.listBefore;
    cursor['pageToken'] = window.pageToken;
    return { cursor, stalled: false };
  }

  // ISO 8601 timestamps sort lexicographically the same as chronologically, so a plain string
  // comparison is enough to find the earliest one — no need to parse back into `Date`s.
  let oldest: string | undefined;
  for (const at of readAt) {
    if (oldest === undefined || at < oldest) oldest = at;
  }
  const narrowed = oldest ?? window.listBefore;
  if (narrowed !== undefined) cursor['listBefore'] = narrowed;

  // Compared at whole-SECOND granularity, not as raw ISO strings: two messages a few milliseconds
  // apart within the same tied second would still make the stored `listBefore` string change tick
  // to tick even though the actual `before:` bound Gmail's query sees — and therefore the query
  // itself — has not, which is the condition that actually defines "no progress" here.
  const stalled =
    oldest !== undefined &&
    window.listBefore !== undefined &&
    unixSeconds(new Date(oldest)) === unixSeconds(new Date(window.listBefore));
  return { cursor, stalled };
}

/**
 * Where a re-seed resumes from: the best anchor `planFetch` has for "the last point this account
 * is known to have covered", falling back to a seven-day window only when it has none at all.
 *
 * A FALLBACK and not a maximum, and the difference is the whole rule. Take a refresh token that
 * died on day 7 and was noticed on day 17. The anchor is day 7, so the search runs from day 7
 * and the ten missing days are ingested. Taking the LATER of the two instead would pick day 10
 * (`now − 7d`) and days 7 through 10 would never be ingested at all — the window silently
 * swallowing every outage longer than itself, which is exactly the case it exists to survive.
 *
 * The caller passes `cursor.resumeAnchor ?? lastSeenAt`, and the two are NOT interchangeable.
 * `lastSeenAt` is right for an ordinary steady-state historyId, where it genuinely does mean "the
 * last time this account made progress". It is wrong for a `resumeHistoryId` that a still-running
 * catch-up minted: `recordPollSuccess` stamps `last_seen_at` on every successful tick, truncated
 * ones included, so by the time a long catch-up's frozen id finally gets tried and turns out to
 * have expired, `last_seen_at` reads as "last tick" rather than "when the catch-up began" — a
 * reseed anchored there would silently discard everything between the two. `resumeAnchor`, carried
 * on the cursor alongside that frozen id until it is used successfully at least once (see
 * `planFetch`), is what preserves the true anchor for exactly that window.
 */
function reseedFrom(anchor: string | undefined, now: Date): Date {
  const seen = anchor === undefined ? undefined : new Date(anchor);
  if (seen !== undefined && !Number.isNaN(seen.getTime())) return seen;
  return new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
}

/** Gmail's `after:` operator takes whole seconds since the epoch. */
function unixSeconds(at: Date): string {
  return String(Math.floor(at.getTime() / 1000));
}

/**
 * File the filtered messages on the unbadged shelf, flagged as the filter's doing.
 *
 * It runs after the insert because that is the only point at which the rows have ids, and it
 * writes only where nothing has judged yet — a re-seed re-delivers messages the owner may since
 * have re-tiered by hand, and their answer outranks the filter's.
 */
async function shelveNewsletters(
  env: GmailEnv,
  accountId: string,
  sourceIds: string[],
  now: Date,
): Promise<void> {
  const rows = await fetchMessageIdsBySourceIds(env, accountId, sourceIds);

  for (const id of rows.values()) {
    await patchMessage(
      env,
      id,
      {
        tier: 'fyi',
        judged_by: 'filter',
        filtered_reason: 'newsletter',
        classified_at: now.toISOString(),
      },
      { onlyIfUnjudged: true },
    );
  }
}

/** One Gmail message as the store takes it. Nothing here can throw on a malformed message. */
function normalize(message: GmailMessage, now: Date): NormalizedMessage {
  const headers = message.payload?.headers;
  const from = parseAddress(headerValue(headers, 'From'));
  const extracted = extractText(message.payload);

  const participants = new Set<string>();
  for (const address of parseAddressList(headerValue(headers, 'To'))) {
    participants.add(address.handle);
  }
  for (const address of parseAddressList(headerValue(headers, 'Cc'))) {
    participants.add(address.handle);
  }

  return {
    source_id: message.id,
    rfc822_message_id: headerValue(headers, 'Message-ID'),
    thread_key: message.threadId,
    // The SENT label is Gmail's own account of who wrote it. The store checks the sender against
    // the account's handles as well, so a message the label misses is still caught.
    direction: (message.labelIds ?? []).includes(SENT_LABEL) ? 'outbound' : 'inbound',
    sender_handle: from?.handle ?? '',
    sender_name: from?.name,
    participants: [...participants],
    subject: headerValue(headers, 'Subject'),
    body: extracted.body,
    received_at: receivedAt(message.internalDate, now),
    body_extracted: extracted.extracted,
    has_attachments: extracted.hasAttachments,
    in_reply_to: parseMessageIdList(headerValue(headers, 'In-Reply-To'))[0],
    references_ids: parseMessageIdList(headerValue(headers, 'References')),
    // Computed here, while `headers` is still in scope — `pollGmail`'s own loop reads
    // `message.payload?.headers` again for `isNewsletter`, but discards it once that call
    // returns, so this is the only place the raw signal survives onto the stored row.
    has_list_header: hasListHeaderSignal(headers),
  };
}

/**
 * When the message arrived, from Gmail's own receipt timestamp rather than any header the sender
 * wrote. A missing or nonsensical one falls back to the poll's instant: the row is worth more with
 * an approximate time than it is thrown away for an exact one.
 */
function receivedAt(internalDate: string | undefined, now: Date): string {
  const ms = Number.parseInt(internalDate ?? '', 10);
  if (Number.isNaN(ms) || Math.abs(ms) > MAX_TIMESTAMP_MS) return now.toISOString();
  return new Date(ms).toISOString();
}
