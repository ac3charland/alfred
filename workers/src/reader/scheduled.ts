/**
 * The Reader's tick: what the five-minute cron runs, and in what order.
 *
 * The ordering is the whole module and every step of it is load-bearing:
 *
 *   config → health start → discovery → roster → ceiling → worklist → token → the loop → health end
 *
 * CONFIG FIRST, and fail closed. The daily ceiling is the money guard, and the one failure
 * it must not have is an unparsable value silently becoming "unlimited" — so a bad var stamps the
 * health row and returns before anything reaches Gmail, let alone the model.
 *
 * THE CEILING IS DERIVED, not counted on the health row: it is `countRows` over the
 * `model_called_at` stamp that every terminal patch writes anyway. A counter on a singleton would
 * need a write per model call — a subrequest the budget cannot spare — plus its own compare-and-set
 * against overlapping ticks, and it would still lose exactly one count when a tick died between
 * the call and the patch, which is the same crash window the stamp has.
 *
 * RETRIES GO AHEAD OF FRESH POSTS, so a post that failed once is never starved by a busy morning.
 * On a capped day the retry read is not even sent: it exists only to feed model calls.
 *
 * THE LOOP IS SEQUENTIAL and bounded twice — by `READER_TICK_LIMIT` (the subrequest budget) and by
 * `READER_TICK_BUDGET_MS` (the wall clock). Rows the budget stops are simply still pending next
 * tick, which is what a cron whose backlog drains over several ticks is for.
 *
 * It never LOGS. `index.ts`'s `logReaderTick` prints one line per unit and one `console.error` per
 * failure, exactly as `logCommsTick` does — the schedule is wiring, and wiring should not decide
 * how anything is reported. And nothing inside calls `new Date()` except to derive UTC midnight
 * from `now`: `now` is the tick's instant for every timestamp it writes, and `clock` exists only
 * to measure ELAPSED time for the budget, which is what lets the budget test inject one.
 */
import { type GmailClient, gmailClient } from '../comms/gmail-api';
import { fetchAccessToken } from '../comms/gmail-oauth';
import { fetchJson, restQueryUrl } from '../supabase';
import { readReaderConfig } from './config';
import { discoverPublications } from './discovery';
import { recordRunError, recordRunStart, recordRunSuccess } from './health';
import { type IntakeResult, NO_READABLE_BODY, intakePost } from './intake';
import { READER_PROMPT_VERSION } from './prompt';
import { JSON_NULL, countRows, leasePost, patchPost } from './store';
import { summarizePost } from './summarize';
import type { ReaderEnv, SummaryInput, SummaryOutcome, WorklistRow } from './types';
import { type RetryRow, fetchFresh, fetchRetries } from './worklist';

/**
 * How many posts one tick will take on, set by the Workers **subrequest budget** — 50 outbound
 * fetches per invocation on the Free plan, and going over throws part-way rather than degrading.
 *
 * | Unit | Fetches | Count |
 * |---|---|---|
 * | Per tick | token mint · discovery read · discovery upsert · roster read · worklist read · pending-retry read · ceiling count · health start · health end | 9 |
 * | Per fresh post | Gmail `messages.get` · insert post · stamp comms row · Anthropic ×2 (one SDK retry) · terminal patch | 6 |
 * | Per retried pending post | lease CAS · Anthropic ×2 · terminal patch | 4 |
 * | Worst tick (six fresh) | 9 + 6 × 6 | **45** |
 *
 * The roster read is the ninth per-tick fetch and is not in the spec's original table: the
 * worklist view carries `publication_id` but not the publication's NAME, which the model's input
 * needs, and reading the roster ONCE per tick is the only way to get it that does not cost a
 * fetch per post. On a tick where discovery found nothing to upsert it simply takes that slot back
 * and the per-tick count is 8 again.
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

/** What one tick did. Every early return reports this same shape. */
export interface ReaderTickSummary {
  /** Publications the discovery upsert actually stored. */
  discovered: number;
  /** Posts inserted this tick — including one immediately filed `failed` for an empty body. */
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
   * day with one awkward newsletter.
   */
  failures: string[];
}

/** The roster, as the one read per tick returns it. */
interface RosterRow {
  id: string;
  name: string;
}

/** One unit of work: a fresh message to read, or a pending post to try again. */
type WorkItem = { kind: 'fresh'; row: WorklistRow } | { kind: 'retry'; row: RetryRow };

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
    input: toSummaryInput({ ...row, text }, roster.get(row.publication_id) ?? row.title),
    attempts: row.summarize_attempts,
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
      // is nothing to retry and nothing to charge against the attempt ceiling.
      await patchPost(env, prepared.id, {
        summary_state: 'refused',
        last_error: 'refused',
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

/**
 * Run one tick. Resolves only when the tick is finished: a scheduled invocation is torn down the
 * moment the promise it returns settles, so anything not awaited here is killed part-way through.
 */
export async function runReaderTick(
  env: ReaderEnv,
  now: Date,
  clock: () => number = () => Date.now(),
): Promise<ReaderTickSummary> {
  const start = clock();
  const nowIso = now.toISOString();

  const parsed = readReaderConfig(env);
  if (!parsed.ok) {
    await recordRunError(env, now, parsed.error);
    return emptySummary([parsed.error]);
  }
  const config = parsed.config;

  // The credential carve-out, checked before anything costs a request. An unset key is otherwise
  // indistinguishable from an outage, and every post would take the transport path forever.
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (apiKey === '') {
    const error = 'ANTHROPIC_API_KEY is not set';
    await recordRunError(env, now, error);
    return emptySummary([error]);
  }

  const summary = emptySummary();
  await recordRunStart(env, now);

  summary.discovered = await discoverPublications(env, now);
  const roster = await readRoster(env);

  // Read once, then kept in step by the tick's own calls. The crash window — a tick dying
  // between a call and its patch — loses one count, which is the same in every design.
  let calls = await countRows(env, 'reader_posts', {
    model_called_at: `gte.${utcMidnight(now).toISOString()}`,
  });
  const capped = (): boolean => calls >= config.dailyCap;

  // Skipped entirely on a capped day: the retry list exists only to feed model calls, while a
  // fresh post's intake is still worth running because the row is the floor whether or not it is
  // read today.
  const retries = capped() ? [] : await fetchRetries(env, now, READER_TICK_LIMIT);
  const fresh = await fetchFresh(env, READER_TICK_LIMIT);
  const work: WorkItem[] = [
    ...retries.map((row): WorkItem => ({ kind: 'retry', row })),
    ...fresh.map((row): WorkItem => ({ kind: 'fresh', row })),
  ].slice(0, READER_TICK_LIMIT);

  // Every Gmail binding is declared optional, because a binding is only as real as the deploy
  // makes it — so an absent one is a systemic failure the health row names, not a crash.
  const missing = MISSING_GMAIL_BINDINGS.find((name) => (env[name] ?? '') === '');
  if (missing !== undefined) {
    const error = `${missing} is not set`;
    await recordRunError(env, now, error);
    summary.failures.push(error);
    return summary;
  }

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
    if (token.reason === 'rejected') await recordRunError(env, now, token.detail);
    summary.failures.push(token.detail);
    return summary;
  }
  const client = gmailClient(token.token);

  for (const item of work) {
    if (clock() - start >= READER_TICK_BUDGET_MS) {
      summary.skippedForBudget += 1;
      continue;
    }

    const prepared =
      item.kind === 'fresh'
        ? await prepareFresh(env, client, item.row, { roster, now, capped: capped(), summary })
        : await prepareRetry(env, item.row, roster, now);

    if (prepared.kind === 'stop') {
      if (prepared.systemic) await recordRunError(env, now, prepared.error);
      summary.failures.push(prepared.error);
      return summary;
    }
    if (prepared.kind === 'skip') continue;
    if (capped()) {
      // The row is stored and unleased; tomorrow's tick summarises it.
      summary.skippedForCap += 1;
      continue;
    }

    const outcome = await summarizePost(prepared.input, { apiKey, model: config.model });
    calls += 1;

    const systemic = await applyOutcome(env, prepared, outcome, {
      model: config.model,
      nowIso,
      summary,
    });
    if (systemic !== undefined) {
      await recordRunError(env, now, systemic);
      summary.failures.push(systemic);
      return summary;
    }
  }

  // Only on a clean pass. A Gmail outage that kept stamping success would read as healthy forever,
  // which is the one thing the health row exists to prevent.
  if (summary.failures.length === 0) await recordRunSuccess(env, now);
  return summary;
}
