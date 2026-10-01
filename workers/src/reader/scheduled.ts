/**
 * The Reader's tick: what the five-minute cron runs, and in what order.
 *
 * The ordering is the whole module and every step of it is load-bearing:
 *
 *   config → credentials → ceiling → health start → discovery → roster → worklist →
 *   To Reader listing → token → the loop → health end
 *
 * CONFIG AND CREDENTIALS FIRST, and fail closed. The daily ceiling is the money guard, and the
 * one failure it must not have is an unparsable value silently becoming "unlimited" — so a bad
 * var stamps the health row and returns before anything reaches Gmail, let alone the model. The
 * Gmail bindings are checked in the same breath and for the same reason: `env` already holds the
 * answer, so learning it from four wasted reads would be a bill for nothing.
 *
 * EVERYTHING ELSE IS INSIDE ONE try/catch. Every store and discovery helper throws on a non-2xx,
 * and a throw that escapes `scheduled()` is recorded by the runtime and by nothing else — no log
 * line, no health stamp, so a module whose every write is being rejected still reads as merely
 * quiet. The catch turns that into the failure the health row is for. It does NOT release the row
 * the tick was on: it has no id to release, and a throw between a lease and its terminal patch
 * deliberately leaves that lease to the staleness bound in `worklist.ts`
 * (`READER_LEASE_STALE_MS`), which is what that bound is for.
 *
 * THE CEILING IS STAMPED BUT DERIVED, not counted on the health row: it is `countRows` over the
 * `model_called_at` stamp that every terminal patch writes anyway. A counter on a singleton would
 * need a write per model call — a subrequest the budget cannot spare — plus its own compare-and-set
 * against overlapping ticks, and it would still lose exactly one count when a tick died between
 * the call and the patch, which is the same crash window the stamp has. What the tick DOES write
 * to the health row is the cap it enforced and how much of it was spent — on the writes it was
 * making anyway, so a reader of that row alone can tell a quiet day from a day that hit its
 * ceiling by noon.
 *
 * THAT COUNT IS READ BEFORE THE RUN-START STAMP, which is why the ceiling sits ahead of the
 * health write in the order above. `last_run_at` and `calls_day` are read together — "the cap is
 * spent" is `calls_today >= daily_cap` for a `calls_day` the reader trusts — so a start stamp
 * that moved `last_run_at` to today while the row still carried YESTERDAY's count would, for the
 * length of the first tick after midnight, describe a day that had already spent a budget it had
 * just been given. Reading first costs nothing: it is the same one fetch either way. The count
 * the tick keeps in step with its own calls then rides every later write, including the one in
 * `runReaderTick`'s catch — a throw must not lose the spend it had already made.
 *
 * RETRIES GO AHEAD OF FRESH POSTS, so a post that failed once is never starved by a busy morning.
 * On a capped day the retry read is not even sent: it exists only to feed model calls.
 *
 * THE TO READER LEG GOES LAST (`to-reader.ts`), and only into the slots the newsletters left: a
 * newsletter is bound by the worklist's seven-day horizon, a bookmark waits in its folder. It lists
 * Instapaper before the Gmail token is minted, so its three fetches are counted before any post
 * is, and on a capped day it does not run at all. Its failures are Instapaper's, never the
 * summariser's: they go to the leg's own health columns and to `summary.instapaper`, and never
 * into `summary.failures`, which is what holds back `last_success_at`. Its outcome rides whichever
 * closing health write the tick makes; the two Gmail stops that make none send it on its own.
 *
 * THE LOOP IS SEQUENTIAL and bounded twice — by `READER_TICK_LIMIT` (the subrequest budget) and by
 * `READER_TICK_BUDGET_MS` (the wall clock). Rows the budget stops are simply still pending next
 * tick, which is what a cron whose backlog drains over several ticks is for.
 *
 * It never LOGS. `index.ts`'s `logReaderTick` prints one line of counts and one `console.error`
 * per failure, as `logCommsTick` does — the schedule is wiring, and wiring should not decide
 * how anything is reported. And nothing inside calls `new Date()` except to derive UTC midnight
 * from `now`: `now` is the tick's instant for every timestamp it writes, and `clock` exists only
 * to measure ELAPSED time for the budget, which is what lets the budget test inject one.
 */
import { type GmailClient, gmailClient } from '../comms/gmail-api';
import { fetchAccessToken } from '../comms/gmail-oauth';
import { instapaperClient, instapaperCredentials } from '../instapaper/client';
import type { InstapaperApi, InstapaperBookmark } from '../instapaper/types';
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';
import { type ReaderConfig, readReaderConfig } from './config';
import { discoverPublications } from './discovery';
import {
  type InstapaperOutcome,
  recordInstapaperHealth,
  recordRunError,
  recordRunStart,
  recordRunSuccess,
} from './health';
import { type IntakeResult, NO_READABLE_BODY, intakePost } from './intake';
import { READER_PROMPT_VERSION } from './prompt';
import { ReaderSweepError, runReaderRetention as sweepReaderText } from './retention';
import {
  type BookmarkedPost,
  JSON_NULL,
  countRows,
  fetchPostsForBookmarks,
  leasePost,
  patchPost,
} from './store';
import { summarizePost } from './summarize';
import {
  NO_FOLDER_ERROR,
  archiveBookmark,
  articlePublication,
  instapaperFailureWords,
  intakeBookmark,
  listToReader,
  planBookmark,
  stopsTheLeg,
} from './to-reader';
import type { ReaderCeiling, ReaderEnv, SummaryInput, SummaryOutcome, WorklistRow } from './types';
import { type RetryRow, fetchFresh, fetchRetries } from './worklist';

/**
 * How many posts one tick will take on, set by the Workers **subrequest budget** — 50 outbound
 * fetches per invocation on the Free plan, and going over throws part-way rather than degrading.
 *
 * | Unit | Fetches | Count |
 * |---|---|---|
 * | Per tick | ceiling count · health start · discovery read · discovery upsert · roster read · pending-retry read · worklist read · token mint · health end | 9 |
 * | Per tick, To Reader leg | Instapaper `folders/list` · `bookmarks/list` · the "already a post?" read | 3 |
 * | Per fresh post | Gmail `messages.get` · insert post · stamp comms row · Anthropic ×2 (one SDK retry) · terminal patch | 6 |
 * | Per new bookmark | Instapaper `get_text` · insert post · Instapaper `archive` · Anthropic ×2 · terminal patch | 6 |
 * | Per bookmark already a post | (restore PATCH) · Instapaper `archive` | ≤ 2 |
 * | Per retried pending post | lease CAS · Anthropic ×2 · terminal patch | 4 |
 * | Worst tick (six new bookmarks) | 9 + 3 + 6 × 6 | **48** |
 *
 * Six fresh newsletters cost 9 + 6 × 6 = 45 and leave the leg no slot, so it never lists. The
 * roster read is the ninth per-tick fetch: the worklist view carries `publication_id` but not the
 * publication's NAME, which the model's input needs, and reading the roster ONCE per tick is the
 * only way to get it that does not cost a fetch per post. On a tick where discovery found nothing
 * to upsert it simply takes that slot back and the per-tick count is 8 again. A bookmark
 * Instapaper has no text for costs 3: `get_text`, an insert filed as failed, `archive`.
 *
 * The post's HTML rides the reads and writes already counted — the intake's own parse, the insert,
 * and two more columns on the pending-retry read — so Further reading adds no fetch.
 *
 * Adding one more fetch per post means dropping this limit to five; adding two means four.
 */
export const READER_TICK_LIMIT = 6;

/**
 * How long the tick will keep STARTING posts. A scheduled invocation has a fifteen-minute
 * wall clock, and six posts at the worst case (60 s × 2 attempts plus a Gmail read) is ~12.5
 * minutes of it — too close. Stopping at eight makes the worst case ~10.
 */
export const READER_TICK_BUDGET_MS = 8 * 60_000;

/** How many content-shaped failures a post gets before it is filed `failed`. */
export const READER_ATTEMPT_CEILING = 3;

/** The three bindings the Gmail read needs, checked before a token exchange can fail on one. */
const MISSING_GMAIL_BINDINGS = [
  'GMAIL_OAUTH_CLIENT_ID',
  'GMAIL_OAUTH_CLIENT_SECRET',
  'GMAIL_PERSONAL_REFRESH_TOKEN',
] as const;

/** What the To Reader leg did on a tick where it listed the folder (or tried to). */
export interface ReaderInstapaperTally {
  /** Bookmarks in To Reader, however many of them this tick took. */
  listed: number;
  /** Articles stored as new posts — including one filed `failed` because Instapaper had no text. */
  taken: number;
  /** Bookmarks archived in Instapaper, for new posts and for ones that were already posts. */
  archived: number;
  /** Posts the owner had archived in the Reader, back on the list because their bookmark was. */
  restored: number;
  /** Each Instapaper failure as the log reads it: the call, the kind and the code. */
  failures: string[];
}

/** Why the leg did not list at all this tick. None of them is a failure, and none is stamped. */
export type ReaderInstapaperSkip = 'unconfigured' | 'capped' | 'no free slot';

/** What one tick did. Every early return reports this same shape. */
export interface ReaderTickSummary {
  /** Publications the discovery upsert actually stored. */
  discovered: number;
  /**
   * Newsletters inserted this tick — including one immediately filed `failed` for an empty body.
   * Articles are counted by the leg, in `instapaper.taken`.
   */
  intake: number;
  /** Posts the model summarised, `done` written. */
  summarized: number;
  /** Posts the model refused. Terminal, and never retried. */
  refused: number;
  /** Content-shaped failures, each charged against a post's three attempts. */
  countedFailures: number;
  /** 429s, 5xxs, timeouts. The post stays pending with its attempt count untouched. */
  uncountedFailures: number;
  /** Posts stored but not summarised because the daily ceiling was already spent. */
  skippedForCap: number;
  /** Posts left for the next tick because the eight-minute budget ran out. */
  skippedForBudget: number;
  /**
   * Why the tick did not complete — a dead credential, a Gmail outage, a systemic model failure.
   * Per-post content failures are NOT in here: they are ordinary operation and belong to the two
   * counters above, and putting them here would stop `last_success_at` ever being stamped on a
   * day with one awkward newsletter. Nor are Instapaper's failures: those are the leg's.
   */
  failures: string[];
  /**
   * The To Reader leg: its tally when it listed (or tried to), why not when it didn't, and absent
   * when the tick stopped before deciding.
   */
  instapaper?: ReaderInstapaperTally | { skipped: ReaderInstapaperSkip } | undefined;
}

/**
 * What `runReaderTick`'s catch can still say about the ceiling, sharpened as the tick learns it.
 *
 * A throw is exactly the moment the spend matters most, and the catch has none of the locals that
 * knew it — so the caller holds a READER rather than a value, called once at the instant of the
 * failure so the count it reports includes every model call the tick had already made. It starts
 * as the cap alone, which is all the config can say, and `tick` replaces it with the live count
 * the moment there is one.
 */
interface CeilingHolder {
  read: () => ReaderCeiling;
  /** The To Reader leg's outcome so far, for the same catch. Nothing until the leg has listed. */
  leg: () => InstapaperOutcome | undefined;
}

/** The roster, as the one read per tick returns it. */
interface RosterRow {
  id: string;
  name: string;
}

/** One unit of work: a fresh message to read, a pending post to try again, or a bookmark to take. */
type WorkItem =
  | { kind: 'fresh'; row: WorklistRow }
  | { kind: 'retry'; row: RetryRow }
  | { kind: 'bookmark'; bookmark: InstapaperBookmark; existing: BookmarkedPost | undefined };

/**
 * The To Reader leg's state across one tick: the client, the tally, the last failure in the
 * owner's words, and how many listed bookmarks have not been handled to the end — a tick that
 * stops before handling them, or that the time budget cut short, has not finished the leg, so it
 * records no success for it. One left in To Reader for the cap is handled: leaving it is its plan.
 */
interface Leg {
  api: InstapaperApi;
  tally: ReaderInstapaperTally;
  error: string | undefined;
  stopped: boolean;
  unreached: number;
}

/** A post ready for the model: which row to patch, what to send, and the count to compare against. */
interface Prepared {
  kind: 'summarize';
  id: string;
  input: SummaryInput;
  attempts: number;
}

/** What one item's preparation decided. `stop` ends the tick; `skip` moves to the next item. */
type PreparedResult =
  | Prepared
  | { kind: 'skip' }
  | { kind: 'stop'; error: string; systemic: boolean };

/** An empty tally, so every early return reports the same shape. */
function emptySummary(failures: string[] = []): ReaderTickSummary {
  return {
    discovered: 0,
    intake: 0,
    summarized: 0,
    refused: 0,
    countedFailures: 0,
    uncountedFailures: 0,
    skippedForCap: 0,
    skippedForBudget: 0,
    failures,
  };
}

/**
 * Midnight UTC of the day `now` falls in — the ceiling's window.
 *
 * The one `new Date` in this module, and it is derived entirely from `now` rather than read from
 * the clock, so a tick stays a pure function of the instant it is handed. UTC rather than the
 * owner's zone because the cap bounds spend against a provider that bills in UTC, and a
 * zone-aware window would move the boundary twice a year for no benefit.
 */
function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The roster, read once and keyed by id: the worklist view carries the id but not the name. */
async function readRoster(env: ReaderEnv): Promise<Map<string, string>> {
  const rows = await fetchJson<RosterRow[]>(
    env,
    restQueryUrl(env, 'reader_publications', { select: 'id,name' }),
    {},
    'GET reader_publications',
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** What the model is shown: the extracted post plus the publication it came from. */
function toSummaryInput(
  post: {
    title: string;
    author?: string | undefined;
    received_at: string;
    word_count: number;
    text: string;
    html?: string | undefined;
    canonical_url?: string | undefined;
  },
  publication: string,
): SummaryInput {
  return {
    publication,
    // `SummaryInput.author` is optional WITHOUT `| undefined`, so under
    // `exactOptionalPropertyTypes` the key has to be omitted rather than set to nothing.
    ...(post.author === undefined ? {} : { author: post.author }),
    title: post.title,
    receivedAt: post.received_at,
    wordCount: post.word_count,
    text: post.text,
    // Optional with `| undefined`, so these are set straight through.
    html: post.html,
    canonicalUrl: post.canonical_url,
  };
}

/** Read, extract, insert and claim one fresh message, and say whether it is worth a model call. */
async function prepareFresh(
  env: ReaderEnv,
  client: GmailClient,
  row: WorklistRow,
  context: { roster: Map<string, string>; now: Date; capped: boolean; summary: ReaderTickSummary },
): Promise<PreparedResult> {
  const publication =
    context.roster.get(row.publication_id) ?? row.sender_name ?? row.sender_handle;
  const result: IntakeResult = await intakePost(env, client, row, {
    publicationName: publication,
    now: context.now,
    capped: context.capped,
  });

  switch (result.kind) {
    case 'systemic': {
      return { kind: 'stop', error: `gmail: ${result.error}`, systemic: true };
    }
    case 'transport': {
      return { kind: 'stop', error: `gmail: ${result.error}`, systemic: false };
    }
    case 'claimed':
    case 'conflict': {
      return { kind: 'skip' };
    }
    case 'failed': {
      context.summary.intake += 1;
      return { kind: 'skip' };
    }
    default: {
      context.summary.intake += 1;
      // A freshly inserted row has made no attempts, which is the base the counted-failure patch
      // compare-and-sets against.
      return {
        kind: 'summarize',
        id: result.id,
        input: toSummaryInput(result.post, publication),
        attempts: 0,
      };
    }
  }
}

/** Take the lease on one pending post, and say whether this tick may retry it. */
async function prepareRetry(
  env: ReaderEnv,
  row: RetryRow,
  roster: Map<string, string>,
  now: Date,
): Promise<PreparedResult> {
  const leased = await leasePost(env, row.id, now);
  // Zero rows is an overlapping tick holding the row, not an error: skip, don't fail.
  if (leased === 0) return { kind: 'skip' };

  const text = row.text ?? '';
  if (text === '') {
    // Nothing to read — either the extraction found no body or a retention sweep has since nulled
    // it. Either way a model call would reach the same answer, so the row is filed and released.
    await patchPost(env, row.id, {
      summary_state: 'failed',
      last_error: NO_READABLE_BODY,
      summarizing_since: JSON_NULL,
    });
    return { kind: 'skip' };
  }

  return {
    kind: 'summarize',
    id: row.id,
    input: toSummaryInput({ ...row, text }, retryPublication(row, roster)),
    attempts: row.summarize_attempts,
  };
}

/**
 * The name a retried post is summarised under. An article's is its linked publication's, else its
 * site, else Instapaper — the same name its row shows. A newsletter's is its roster name. The
 * post's own TITLE is never the fallback: it is not the name of anything that publishes. A roster
 * row that has gone (a renamed handle, a deleted publication) leaves the author, and then the same
 * 'unknown' the eval script prints for a message with no usable `From` name.
 */
function retryPublication(row: RetryRow, roster: Map<string, string>): string {
  if (row.source === 'instapaper') return articlePublication(row.publication_id, row.site, roster);
  const linked = row.publication_id === undefined ? undefined : roster.get(row.publication_id);
  return linked ?? row.author ?? 'unknown';
}

/**
 * A leg failure: logged as the client wrote it — prefixed with the bookmark it was about, when it
 * was about one, so the log says which article to look at — and stamped in the owner's words.
 */
function legFailure(leg: Leg, error: unknown, bookmarkId?: number): void {
  const about = bookmarkId === undefined ? '' : `bookmark ${String(bookmarkId)}: `;
  leg.tally.failures.push(`${about}${describe(error)}`);
  leg.error = instapaperFailureWords(error);
  if (stopsTheLeg(error)) leg.stopped = true;
}

/** The archive every bookmark plan ends in, tallied either way. */
function noteArchive(
  leg: Leg,
  bookmarkId: number,
  archive: { ok: true } | { ok: false; error: unknown },
): void {
  if (archive.ok) leg.tally.archived += 1;
  else legFailure(leg, archive.error, bookmarkId);
}

/**
 * Carry out one bookmark's plan (`planBookmark`), and say whether there is now a post for the
 * model. Only a freshly taken article with text is; a bookmark that is already a post is only
 * archived — restored first, when the owner had archived its post in the Reader.
 */
async function prepareBookmark(
  env: ReaderEnv,
  leg: Leg,
  item: { bookmark: InstapaperBookmark; existing: BookmarkedPost | undefined },
  context: { roster: Map<string, string>; now: Date; capped: boolean; summary: ReaderTickSummary },
): Promise<PreparedResult> {
  const plan = planBookmark(item.existing, context.capped);
  switch (plan.kind) {
    case 'leave': {
      context.summary.skippedForCap += 1;
      return { kind: 'skip' };
    }
    case 'restore': {
      await patchPost(env, plan.postId, { archived_at: JSON_NULL });
      leg.tally.restored += 1;
      noteArchive(
        leg,
        item.bookmark.bookmarkId,
        await archiveBookmark(leg.api, item.bookmark.bookmarkId),
      );
      return { kind: 'skip' };
    }
    case 'archive': {
      noteArchive(
        leg,
        item.bookmark.bookmarkId,
        await archiveBookmark(leg.api, item.bookmark.bookmarkId),
      );
      return { kind: 'skip' };
    }
    default: {
      break;
    }
  }

  const taken = await intakeBookmark(env, leg.api, item.bookmark, context.now);
  switch (taken.kind) {
    case 'unread': {
      // Nothing was written, so the bookmark is still in To Reader and still no post's. Unless
      // Instapaper's answer is one every later call would get too (a rejected credential, a lapsed
      // Premium, a rate limit — `legFailure` stops the leg for those), the tick moves on: the
      // bookmarks are taken oldest first, so an article Instapaper can never read would otherwise
      // head the queue every tick and hold the whole folder back. The log names it.
      legFailure(leg, taken.error, item.bookmark.bookmarkId);
      return { kind: 'skip' };
    }
    case 'conflict': {
      return { kind: 'skip' };
    }
    case 'filed': {
      leg.tally.taken += 1;
      noteArchive(leg, item.bookmark.bookmarkId, taken.archive);
      return { kind: 'skip' };
    }
    default: {
      leg.tally.taken += 1;
      // A failed archive leaves the post in place and summarised; next tick's "already a post?"
      // read finds it and archives the bookmark then.
      noteArchive(leg, item.bookmark.bookmarkId, taken.archive);
      return {
        kind: 'summarize',
        id: taken.id,
        input: {
          publication: articlePublication(undefined, taken.site, context.roster),
          title: taken.title,
          receivedAt: context.now.toISOString(),
          wordCount: taken.wordCount,
          text: taken.text,
          html: taken.html,
          canonicalUrl: taken.canonicalUrl,
        },
        attempts: 0,
      };
    }
  }
}

/**
 * The leg's outcome, as a health write records it: its failure when it had one, a success when it
 * listed and reached every bookmark it took, and nothing otherwise — a leg that did not run, or
 * that a Gmail stop cut off before its bookmarks, has nothing true to say.
 */
function legOutcome(leg?: Leg): InstapaperOutcome | undefined {
  if (leg === undefined) return undefined;
  if (leg.error !== undefined) return { kind: 'error', error: leg.error };
  return leg.unreached === 0 ? { kind: 'success' } : undefined;
}

/**
 * List To Reader and read which bookmarks are already posts, or record why it couldn't. Runs only
 * with the secrets set, the day uncapped and a slot free. A listing failure is the leg's alone:
 * it is stamped, and the tick carries on with its newsletters.
 */
async function openLeg(
  env: ReaderEnv,
  api: InstapaperApi,
  slots: number,
): Promise<{ leg: Leg; items: WorkItem[] }> {
  const leg: Leg = {
    api,
    tally: { listed: 0, taken: 0, archived: 0, restored: 0, failures: [] },
    error: undefined,
    stopped: false,
    unreached: 0,
  };

  let listing: Awaited<ReturnType<typeof listToReader>>;
  try {
    listing = await listToReader(api, slots);
  } catch (error) {
    legFailure(leg, error);
    return { leg, items: [] };
  }
  if (listing.kind === 'no-folder') {
    leg.tally.failures.push(NO_FOLDER_ERROR);
    leg.error = NO_FOLDER_ERROR;
    return { leg, items: [] };
  }

  leg.tally.listed = listing.listed;
  leg.unreached = listing.marks.length;
  const existing = await fetchPostsForBookmarks(
    env,
    listing.marks.map((mark) => mark.bookmarkId),
  );
  const byBookmark = new Map(existing.map((post) => [post.bookmarkId, post]));
  return {
    leg,
    items: listing.marks.map(
      (bookmark): WorkItem => ({
        kind: 'bookmark',
        bookmark,
        existing: byBookmark.get(bookmark.bookmarkId),
      }),
    ),
  };
}

/**
 * Write the terminal patch for one model attempt (the outcome table), and report a systemic failure if that is
 * what came back.
 *
 * Every row of the table releases the lease, and every row that made a real call stamps
 * `model_called_at` — including the uncounted ones. A timeout may well have been billed, and the
 * ceiling exists to bound money, so it counts conservatively.
 */
async function applyOutcome(
  env: ReaderEnv,
  prepared: Prepared,
  outcome: SummaryOutcome,
  context: { model: string; nowIso: string; summary: ReaderTickSummary },
): Promise<string | undefined> {
  const { model, nowIso, summary } = context;

  switch (outcome.kind) {
    case 'done': {
      await patchPost(env, prepared.id, {
        headline: outcome.summary.headline,
        gist: outcome.summary.gist,
        overview: outcome.summary.overview,
        model,
        prompt_version: READER_PROMPT_VERSION,
        summary_state: 'done',
        summarized_at: nowIso,
        model_called_at: nowIso,
        last_error: JSON_NULL,
        summarizing_since: JSON_NULL,
      });
      summary.summarized += 1;
      return undefined;
    }

    case 'refused': {
      // Terminal and uncounted: re-sending an identical prompt cannot change a refusal, so there
      // is nothing to retry and nothing to charge against the attempt ceiling. `last_error`
      // carries the model's own explanation when the API supplied one, read the same way a
      // content-shaped failure's reason is (`gistOrPlaceholder` in `post-row.tsx`) — nulled out
      // rather than left stale when there isn't one, so the row falls back to a generic line.
      await patchPost(env, prepared.id, {
        summary_state: 'refused',
        last_error: outcome.explanation ?? JSON_NULL,
        model_called_at: nowIso,
        summarizing_since: JSON_NULL,
      });
      summary.refused += 1;
      return undefined;
    }

    case 'counted': {
      const attempts = prepared.attempts + 1;
      await patchPost(
        env,
        prepared.id,
        {
          summarize_attempts: attempts,
          last_error: outcome.error,
          model_called_at: nowIso,
          summarizing_since: JSON_NULL,
          // Three failures in a row on the same prompt is a bug in the prompt, not bad luck — so
          // the ceiling is where a post stops costing money and starts being visible as failed.
          ...(attempts >= READER_ATTEMPT_CEILING ? { summary_state: 'failed' } : {}),
        },
        { ifAttemptsEquals: prepared.attempts },
      );
      summary.countedFailures += 1;
      return undefined;
    }

    case 'uncounted': {
      // The post is fine, the moment was not: state stays `pending` and the next tick retries it
      // with its attempt count untouched.
      await patchPost(env, prepared.id, {
        last_error: outcome.error,
        model_called_at: nowIso,
        summarizing_since: JSON_NULL,
      });
      summary.uncountedFailures += 1;
      return undefined;
    }

    default: {
      // Systemic: the deploy is wrong for every post, so the tick releases this row's lease and
      // stops rather than discovering the same 401 five more times at the ceiling's expense.
      await patchPost(env, prepared.id, { summarizing_since: JSON_NULL });
      return `${outcome.reason}: ${outcome.error}`;
    }
  }
}

/** Whatever was thrown, as a line the health row can carry — as `comms/scheduled.ts` spells it. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one tick. Resolves only when the tick is finished: a scheduled invocation is torn down the
 * moment the promise it returns settles, so anything not awaited here is killed part-way through.
 *
 * Nothing thrown gets out. Every store and discovery helper throws on a non-2xx, and a throw that
 * reaches `scheduled()` is invisible everywhere the health row is read — so it is recorded there
 * instead, with whatever the tick had already counted kept.
 */
export async function runReaderTick(
  env: ReaderEnv,
  now: Date,
  clock: () => number = () => Date.now(),
): Promise<ReaderTickSummary> {
  const parsed = readReaderConfig(env);
  if (!parsed.ok) {
    await recordRunError(env, now, parsed.error);
    return emptySummary([parsed.error]);
  }

  const summary = emptySummary();
  // The cap is known here and the count is not, which is exactly what the catch below would
  // otherwise have to guess. `tick` replaces this reader once it has counted.
  const config = parsed.config;
  const holder: CeilingHolder = {
    read: () => ({ daily_cap: config.dailyCap }),
    // No leg has listed yet, which is exactly what this reads as until `tick` replaces it.
    leg: () => legOutcome(),
  };
  try {
    return await tick(env, now, clock, config, summary, holder);
  } catch (error) {
    const message = describe(error);
    await recordRunError(env, now, message, holder.read(), holder.leg());
    summary.failures.push(message);
    return summary;
  }
}

/** The tick itself, tallying into the `summary` its caller holds so a throw keeps what it earned. */
async function tick(
  env: ReaderEnv,
  now: Date,
  clock: () => number,
  config: ReaderConfig,
  summary: ReaderTickSummary,
  holder: CeilingHolder,
): Promise<ReaderTickSummary> {
  const start = clock();
  const nowIso = now.toISOString();

  // The credential carve-out, checked before anything costs a request. An unset key is otherwise
  // indistinguishable from an outage, and every post would take the transport path forever.
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (apiKey === '') {
    const error = 'ANTHROPIC_API_KEY is not set';
    await recordRunError(env, now, error, { daily_cap: config.dailyCap });
    summary.failures.push(error);
    return summary;
  }

  // Every Gmail binding is declared optional, because a binding is only as real as the deploy
  // makes it — so an absent one is a systemic failure the health row names, not a crash. Checked
  // here, beside the other credential, rather than after four reads that `env` already answers.
  const missing = MISSING_GMAIL_BINDINGS.find((name) => (env[name] ?? '') === '');
  if (missing !== undefined) {
    const error = `${missing} is not set`;
    await recordRunError(env, now, error, { daily_cap: config.dailyCap });
    summary.failures.push(error);
    return summary;
  }

  // Read once — BEFORE the run-start stamp, so `last_run_at` never moves to today while the row
  // still carries yesterday's count (see the module comment) — then kept in step by the tick's
  // own calls. The crash window — a tick dying between a call and its patch — loses one count,
  // which is the same in every design. A throw here is caught by `runReaderTick`, which stamps
  // the error with the cap alone: the count is precisely what could not be read.
  let calls = await countRows(env, 'reader_posts', {
    model_called_at: `gte.${utcMidnight(now).toISOString()}`,
  });
  const capped = (): boolean => calls >= config.dailyCap;
  /**
   * What the tick has spent, as of right now — read at the moment a health write happens, so a
   * terminal stamp reports the count INCLUDING the calls this tick made rather than the one it
   * started from. The day is the UTC date the count was taken over, the same window `calls` is
   * counted in.
   */
  const ceiling = (): ReaderCeiling => ({
    daily_cap: config.dailyCap,
    calls_today: calls,
    calls_day: now.toISOString().slice(0, 10),
  });
  holder.read = ceiling;

  await recordRunStart(env, now, ceiling());

  summary.discovered = await discoverPublications(env, now);
  const roster = await readRoster(env);

  // Skipped entirely on a capped day: the retry list exists only to feed model calls, while a
  // fresh post's intake is still worth running because the row is the floor whether or not it is
  // read today.
  const retries = capped() ? [] : await fetchRetries(env, now, READER_TICK_LIMIT);
  const fresh = await fetchFresh(env, READER_TICK_LIMIT);
  const work: WorkItem[] = [
    ...retries.map((row): WorkItem => ({ kind: 'retry', row })),
    ...fresh.map((row): WorkItem => ({ kind: 'fresh', row })),
  ].slice(0, READER_TICK_LIMIT);

  // The To Reader leg takes only what the newsletters and retries left of the per-tick limit. It
  // lists before the token is minted, so its fetches are spent, and counted, ahead of any post's.
  const slots = Math.max(0, READER_TICK_LIMIT - retries.length - fresh.length);
  const credentials = instapaperCredentials(env);
  let leg: Leg | undefined;
  if (credentials === undefined) {
    summary.instapaper = { skipped: 'unconfigured' };
  } else if (capped()) {
    summary.instapaper = { skipped: 'capped' };
  } else if (slots === 0) {
    summary.instapaper = { skipped: 'no free slot' };
  } else {
    const opened = await openLeg(env, instapaperClient(credentials), slots);
    leg = opened.leg;
    summary.instapaper = opened.leg.tally;
    work.push(...opened.items);
  }
  const legNow = (): InstapaperOutcome | undefined => legOutcome(leg);
  holder.leg = legNow;

  const token = await fetchAccessToken(
    {
      GMAIL_OAUTH_CLIENT_ID: env.GMAIL_OAUTH_CLIENT_ID ?? '',
      GMAIL_OAUTH_CLIENT_SECRET: env.GMAIL_OAUTH_CLIENT_SECRET ?? '',
    },
    env.GMAIL_PERSONAL_REFRESH_TOKEN ?? '',
  );
  if (!token.ok) {
    // A rejected refresh token needs a human, so it is stamped on the health row. A transport
    // failure is not: Google having a bad minute must not read as a broken module, and the next
    // tick is the retry. Neither stamps success — the work did not happen.
    await (token.reason === 'rejected'
      ? recordRunError(env, now, token.detail, ceiling(), legNow())
      : recordLegAlone(env, now, legNow()));
    summary.failures.push(token.detail);
    return summary;
  }
  const client = gmailClient(token.token);

  for (const item of work) {
    // A bookmark counts as reached only once its handling is over — never before its writes, so
    // a throw part-way through cannot leave the leg reading as finished. One the budget leaves in
    // To Reader is never reached, which is what keeps that tick from stamping the leg's success.
    const reached = (): void => {
      if (item.kind === 'bookmark' && leg !== undefined) leg.unreached -= 1;
    };

    // A leg Instapaper has stopped answering leaves the rest of its bookmarks in To Reader; the
    // failure that stopped it is the leg's outcome.
    if (item.kind === 'bookmark' && leg?.stopped === true) {
      reached();
      continue;
    }

    if (clock() - start >= READER_TICK_BUDGET_MS) {
      summary.skippedForBudget += 1;
      continue;
    }

    // A capped retry is not even prepared. Its preparation IS the lease, and claiming a row this
    // tick will not summarise strands it until the staleness bound releases it a quarter of an
    // hour later — where a fresh post's insert-as-claim simply leaves the lease free.
    if (item.kind === 'retry' && capped()) {
      summary.skippedForCap += 1;
      continue;
    }

    const prepared = await prepareItem(env, client, item, leg, {
      roster,
      now,
      capped: capped(),
      summary,
    });

    if (prepared.kind === 'stop') {
      await (prepared.systemic
        ? recordRunError(env, now, prepared.error, ceiling(), legNow())
        : recordLegAlone(env, now, legNow()));
      summary.failures.push(prepared.error);
      return summary;
    }
    if (prepared.kind === 'skip') {
      reached();
      continue;
    }
    if (capped()) {
      // The row is stored and unleased; tomorrow's tick summarises it.
      summary.skippedForCap += 1;
      reached();
      continue;
    }

    const outcome = await summarizePost(prepared.input, { apiKey, model: config.model });
    calls += 1;

    const systemic = await applyOutcome(env, prepared, outcome, {
      model: config.model,
      nowIso,
      summary,
    });
    reached();
    if (systemic !== undefined) {
      await recordRunError(env, now, systemic, ceiling(), legNow());
      summary.failures.push(systemic);
      return summary;
    }
  }

  // Only on a clean pass — every path that pushes a failure has already returned. A Gmail outage
  // that kept stamping success would read as healthy forever, which is the one thing the health
  // row exists to prevent.
  await recordRunSuccess(env, now, ceiling(), legNow());
  return summary;
}

/** Prepare one unit of work, whichever kind it is. */
function prepareItem(
  env: ReaderEnv,
  client: GmailClient,
  item: WorkItem,
  leg: Leg | undefined,
  context: { roster: Map<string, string>; now: Date; capped: boolean; summary: ReaderTickSummary },
): Promise<PreparedResult> {
  switch (item.kind) {
    case 'fresh': {
      return prepareFresh(env, client, item.row, context);
    }
    case 'retry': {
      return prepareRetry(env, item.row, context.roster, context.now);
    }
    default: {
      // A bookmark item only exists because a leg listed it.
      if (leg === undefined) return Promise.resolve({ kind: 'skip' });
      return prepareBookmark(env, leg, item, context);
    }
  }
}

/**
 * The leg's outcome on a path that makes no closing health write — so the Instapaper dot still
 * learns what the leg found. Nothing at all when the leg has nothing to say.
 */
async function recordLegAlone(
  env: ReaderEnv,
  now: Date,
  outcome: InstapaperOutcome | undefined,
): Promise<void> {
  if (outcome !== undefined) await recordInstapaperHealth(env, now, outcome);
}

// ── Retention ────────────────────────────────────────────────────────────────

/**
 * What one retention run did.
 *
 * The same failure convention as `CommsRetentionSummary`: a unit that threw names itself in
 * `failures`, and `swept: undefined` reads as "did not run", so a sweep that never got going
 * stays distinguishable from a clean one that had nothing to do.
 *
 * With one refinement the comms sweep has no use for: every batch is its OWN transaction, so a
 * run that broke on its fourth batch really did sweep the first three, and those rows are
 * durable. `swept` therefore carries that PARTIAL count alongside the failure — a broken run
 * reports "did not run" only when it broke before any batch committed, which is the one case
 * where nothing was in fact swept.
 */
export interface ReaderRetentionSummary {
  swept: number | undefined;
  failures: string[];
}

/**
 * Run the text sweep, on its own schedule and its own try/catch — mirrors `runCommsRetention`
 * in `comms/scheduled.ts`. A throw here must never stop the comms retention sweep `index.ts` runs
 * alongside it, and vice versa, so each wrapper owns its own failure handling rather than sharing
 * one try/catch across both units.
 */
export async function runReaderRetention(
  env: SupabaseEnv,
  now: Date,
): Promise<ReaderRetentionSummary> {
  const failures: string[] = [];

  let swept: number | undefined;
  try {
    const result = await sweepReaderText(env, now);
    swept = result.swept;
  } catch (error) {
    // Whatever the batches before the failure committed is already durable, so it is reported
    // beside the failure rather than thrown away — the log then says both how far the sweep got
    // and that it broke. Nothing committed (or a throw that is not the sweep's own) leaves
    // `swept` undefined, which is the "did not run" line.
    const partial = error instanceof ReaderSweepError ? error.swept : 0;
    if (partial > 0) swept = partial;
    failures.push(`reader retention: ${describe(error)}`);
  }

  return { swept, failures };
}
