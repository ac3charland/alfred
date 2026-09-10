/**
 * The comms classifier sweep — judging the messages that have arrived.
 *
 * One classifier for all four accounts, running here rather than at each source: the alternative
 * is a rubric per source, drifting apart, and a second model credential on a laptop.
 *
 * The loop is the whole retry mechanism, as in the Inbox sweep: a message that failed is simply
 * still unjudged on the next tick, so there is no queue, no backoff state and no dead-letter. What
 * differs — and it is the reason this file is not a copy of `../sweep.ts` — is WHICH failures
 * count against the attempt ceiling. The Inbox counts every one of them uniformly, which is safe
 * there because its ceiling is inert: a row that exhausts it goes on being an ordinary
 * unclassified Inbox item. Here the ceiling is ACTIVE — a message that exhausts it lands on a
 * counted tier — so counting transport failures would turn a twenty-minute Anthropic incident
 * into the entire inbound stream deposited into Today, none of it drainable by replying because
 * nobody owes a reply to a newsletter. So:
 *
 *   - transport (429, 5xx, timeout, network) — nothing written, nothing counted, next tick retries;
 *   - systemic (no key, a rejected credential, a 400 on a request shape identical for every
 *     message) — the tick aborts, having written nothing, and stamps the classifier's health;
 *   - content-shaped (unparseable, a tier outside the enum, max_tokens) — one attempt counted,
 *     and at five the message is parked on Today, marked, with no further model call;
 *   - a refusal — terminal, filed on the shelf with a flag, and never retried.
 *
 * Nothing is ever silently shelved: the two can't-judge paths (a body that never decoded, and a
 * message that spent every attempt) both land on Today rather than on the shelf, because what
 * alfred could not judge is unknown, and unknown is not nothing.
 */
import { type ClassifierEnv, type JsonOutcome, classifyJson } from '../classifier';
import type { SupabaseEnv } from '../supabase';
import { EXAMPLE_WINDOW, selectCommExamples } from './examples';
import { COMMS_PROMPT_VERSION, buildCommsRequest, resolveSender } from './prompt';
import {
  fetchAccounts,
  fetchCurrentRubric,
  fetchExampleSetVersion,
  fetchExamples,
  fetchPeople,
  fetchReclassifyRequests,
  fetchUnjudgedAtCeiling,
  fetchUnjudgedMessages,
  insertVerdict,
  patchMessage,
  recordClassifierRun,
} from './store';
import { clearReclassifyRequest } from './sweep-store';
import type {
  ClassifierHealthPatch,
  CommAccount,
  CommExample,
  CommMessage,
  CommPerson,
  CommRubric,
  CommTier,
  JudgedBy,
} from './types';
import {
  REFUSAL_ASK,
  REFUSAL_TIER,
  UNJUDGED_CEILING_ASK,
  UNJUDGED_DECODE_ASK,
  UNJUDGED_TIER,
  applyFloor,
  capForBacklog,
  parseCommVerdict,
} from './verdict';

/**
 * How many messages one tick will judge. Messages over the cap are simply still unjudged next
 * tick, so deferring them is free — and the cap is what keeps a tick's wall time bounded against
 * a schedule that does not serialize its invocations.
 */
export const COMMS_SWEEP_LIMIT = 10;

/**
 * How many content-shaped failures a message gets before it is parked rather than retried. Five
 * failures in a row on the same prompt is a bug in the prompt, not bad luck — so the ceiling is
 * where a message stops costing money and starts being visible.
 */
export const COMMS_ATTEMPT_CEILING = 5;

/** Stamped onto every verdict, so a future provider comparison is a query, not a migration. */
export const PROVIDER = 'anthropic';

/** The rubric version stamped when there is no rubric — nobody has written one yet. */
export const NO_RUBRIC_VERSION = 0;

/**
 * The three log banners that mean "the configuration is wrong, not the message". Distinct text
 * per cause, because the fixes differ: a credential wants `wrangler secret put`, a rejected
 * request wants a code change, an absent var wants a deploy that carries it.
 */
export const CREDENTIAL_FAILURE = 'comms classifier: aborting the sweep — credential failure';
export const REQUEST_FAILURE =
  'comms classifier: aborting the sweep — the API rejected the request';
export const CONFIG_FAILURE = 'comms classifier: aborting the sweep — a required var is not set';

/** The database, the model credential, and the zone a relative deadline resolves against. */
export interface CommsSweepEnv extends SupabaseEnv, ClassifierEnv {
  CLASSIFIER_TIMEZONE: string;
}

/** What one sweep did. `aborted` means a configuration fault stopped it before it spent anything. */
export interface CommsSweepSummary {
  /**
   * Messages this tick took off the worklist. Rows parked at the attempt ceiling are NOT among
   * them — the worklist query excludes them by definition — so `parked` can exceed `eligible`.
   */
  eligible: number;
  /** Messages the model judged, verdict written. */
  classified: number;
  /** Messages that failed in a way that counted an attempt and left them unjudged. */
  failed: number;
  /**
   * Messages filed with no verdict behind them: the attempt ceiling, a body that never decoded,
   * and a refusal. Counted apart from `classified` because none of them cost a judgment — the
   * number is how you notice a decode bug or a prompt bug from the log alone.
   */
  parked: number;
  aborted: boolean;
}

/** Everything one tick reads once and every message in it is judged against. */
interface SweepContext {
  accounts: Map<string, CommAccount>;
  rubric: CommRubric | undefined;
  examples: CommExample[];
  exampleSetVersion: number;
  people: CommPerson[];
}

/** An empty tally, so every early return reports the same shape. */
function emptySummary(aborted: boolean): CommsSweepSummary {
  return { eligible: 0, classified: 0, failed: 0, parked: 0, aborted };
}

/**
 * Which required bindings did not actually arrive on this deploy.
 *
 * The cast is the point rather than a workaround: `Env` declares the two vars `string`, but a
 * binding is only as real as the deploy makes it — a CLI `--var` that shadows the file's `[vars]`
 * rather than merging with them leaves the field `undefined` with nothing in the type system to
 * say so. Read at the declared type this check is dead code the compiler can prove unreachable;
 * read at the type the runtime can produce, it is the difference between one log line and a
 * classifier that silently judges nothing.
 */
function unsetVars(env: CommsSweepEnv): string[] {
  const required = ['CLASSIFIER_MODEL', 'CLASSIFIER_TIMEZONE'] as const;
  return required.filter((name) => {
    const value = env[name] as string | undefined;
    return value === undefined || value === '';
  });
}

/**
 * Report what this run did to the health row.
 *
 * Never throws: the health row is how the module SAYS something is wrong, and a failure to write
 * it must not replace the failure it was reporting. Stamped even on a tick with nothing to judge,
 * because "stalled since 09:40" is the reading that matters and a quiet night is not a stall.
 */
async function stampHealth(env: CommsSweepEnv, patch: ClassifierHealthPatch): Promise<void> {
  try {
    await recordClassifierRun(env, patch);
  } catch (error) {
    console.error('comms classifier: could not record the classifier health', error);
  }
}

/**
 * The messages this tick may judge: the owner's explicit re-run requests first, then whatever is
 * unjudged, deduped and capped.
 *
 * Re-runs go first because they are rare and someone is waiting on them — a steady trickle of new
 * mail would otherwise starve a re-run out of every tick's budget. A row can appear in both lists
 * (an unjudged message the owner asked to re-run), so the union is keyed by id.
 */
async function readEligible(env: CommsSweepEnv): Promise<CommMessage[]> {
  const [reruns, unjudged] = await Promise.all([
    fetchReclassifyRequests(env, { limit: COMMS_SWEEP_LIMIT }),
    fetchUnjudgedMessages(env, {
      limit: COMMS_SWEEP_LIMIT,
      attemptCeiling: COMMS_ATTEMPT_CEILING,
    }),
  ]);

  const byId = new Map<string, CommMessage>();
  for (const message of [...reruns, ...unjudged]) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  // Both queries are capped at the limit, so their union can be twice it — and the cap is what
  // bounds the tick's wall time against a schedule that does not serialize its invocations.
  return [...byId.values()].slice(0, COMMS_SWEEP_LIMIT);
}

/**
 * Everything a prompt is assembled from, read ONCE per tick rather than once per message: none of
 * it changes inside a sweep, and the example draw is a pure function of the window.
 */
async function readContext(env: CommsSweepEnv): Promise<SweepContext> {
  const [accounts, rubric, window, exampleSetVersion, people] = await Promise.all([
    fetchAccounts(env),
    fetchCurrentRubric(env),
    fetchExamples(env, { limit: EXAMPLE_WINDOW }),
    fetchExampleSetVersion(env),
    fetchPeople(env),
  ]);

  return {
    accounts: new Map(accounts.map((account) => [account.id, account])),
    rubric,
    examples: selectCommExamples(window),
    exampleSetVersion,
    people,
  };
}

/** Whether the owner asked for this row to be judged again. Nothing is ever re-judged silently. */
function isRerun(message: CommMessage): boolean {
  return message.reclassify_requested_at !== undefined;
}

/**
 * File a message alfred could not judge, or one the model refused, and say whether a row matched.
 *
 * `onlyIfUnjudged` unless this is a re-run, for the reason every write here is conditional:
 * scheduled invocations are not serialized, so a slow tick can overlap the next and both can read
 * the same unjudged row. The loser matches nothing instead of stamping over the winner.
 */
async function file(
  env: CommsSweepEnv,
  message: CommMessage,
  disposition: { tier: CommTier; judged_by: JudgedBy; ask: string },
  now: Date,
): Promise<boolean> {
  const rows = await patchMessage(
    env,
    message.id,
    { ...disposition, classified_at: now.toISOString() },
    { onlyIfUnjudged: !isRerun(message) },
  );
  if (rows > 0 && isRerun(message)) await clearReclassifyRequest(env, message.id);
  return rows > 0;
}

/**
 * Park every message that has spent all five attempts, without a model call.
 *
 * These rows are already out of the sweep's worklist — the query that finds work excludes them —
 * so this is the only thing that ever looks at them again. Parked on a counted tier and marked as
 * unjudged, because the alternative to a marked row is an invisible message, and a message nobody
 * could judge is the one there is no verdict to audit.
 */
async function parkAtCeiling(env: CommsSweepEnv, now: Date): Promise<number> {
  const stuck = await fetchUnjudgedAtCeiling(env, {
    attemptCeiling: COMMS_ATTEMPT_CEILING,
    limit: COMMS_SWEEP_LIMIT,
  });

  let parked = 0;
  for (const message of stuck) {
    const filed = await file(
      env,
      message,
      { tier: UNJUDGED_TIER, judged_by: 'unjudged', ask: UNJUDGED_CEILING_ASK },
      now,
    );
    if (filed) parked += 1;
  }
  return parked;
}

/**
 * Record one content-shaped failure. Costs no extra read — the sweep already selected the counter,
 * so this PATCHes `n + 1` from the value in hand. Never throws: one message's bad luck must not
 * abort the tick, and a counter that failed to increment is only ever one wasted retry.
 *
 * `ifAttemptsEquals` makes the increment compare-and-set on the count as it was READ at the top
 * of the tick — for the same reason every other write in this file is conditional: scheduled
 * invocations are not serialized, so two overlapping ticks can both read `classify_attempts: n`,
 * both fail, and both PATCH `n + 1`. Without the filter both writes land and one real, billed
 * failure goes uncounted — the attempt ceiling can then take up to ~2x its stated number of real
 * model calls to actually fire. With it, a write whose base has moved matches nothing: a no-op,
 * not an error, because the count is already right, just not written by this call.
 */
async function countAttempt(env: CommsSweepEnv, message: CommMessage): Promise<void> {
  try {
    const rows = await patchMessage(
      env,
      message.id,
      { classify_attempts: message.classify_attempts + 1 },
      { ifAttemptsEquals: message.classify_attempts },
    );
    if (rows === 0) {
      console.error(
        `comms classifier: message ${message.id}'s attempt was already counted by another tick`,
      );
    }
  } catch (error) {
    console.error(`comms classifier: could not count an attempt for ${message.id}`, error);
  }
}

/**
 * Write one judgment: the verdict row with its full provenance, then the message pointed at it.
 *
 * Two writes rather than one because they are two different records. The verdict is history —
 * a re-classification inserts another one rather than destroying the old, so "why did it say
 * that" survives the tier moving on — while the message carries the tier the owner actually sees.
 *
 * The tier stored on BOTH is the effective one, after the floor and the backlog cap. A verdict
 * that recorded the model's raw answer while the row showed something else would make the two
 * disagree in exactly the situation someone is auditing them.
 */
async function writeVerdict(
  env: CommsSweepEnv,
  message: CommMessage,
  context: SweepContext,
  raw: unknown,
  now: Date,
): Promise<'classified' | 'failed' | 'raced'> {
  const parsed = parseCommVerdict(raw);
  if (parsed === undefined) {
    console.error(`comms classifier: message ${message.id} came back in an unusable shape`);
    await countAttempt(env, message);
    return 'failed';
  }

  const verdict = applyFloor(parsed);
  const tier = capForBacklog(verdict.tier, {
    receivedAt: new Date(message.received_at),
    now,
  });
  const person = resolveSender(message.sender_handle, context.people);

  try {
    // The model call above is this function's long leg — real network seconds, not
    // milliseconds — so it is also where an overlapping tick is most likely to have already
    // judged this same message while this one was waiting. Re-testing "still unjudged" right
    // here, immediately before paying for a verdict insert, catches most of those races before
    // an unreferenced verdict row gets written for them. It is a value-preserving write (the
    // count goes back to what it already was) purely so it can reuse `onlyIfUnjudged`'s existing
    // filter rather than adding a read path of its own; "0 rows" means exactly what it means on
    // every other conditional write here.
    //
    // `ifAttemptsEquals` is combined in here for the reason `countAttempt` has it: this write's
    // own payload carries `classify_attempts`, set to the value read at the TOP of this tick —
    // filtered on `tier` alone, that write still MATCHES (and executes) whenever a concurrent
    // tick's `countAttempt` has legitimately CAS-incremented the counter in the meantime, and it
    // stamps that stale, lower count straight back over the real one, silently erasing the other
    // tick's billed attempt. Adding the filter here closes exactly that: a base that has moved —
    // tier OR attempts — now makes this write match nothing, so it can no longer clobber.
    //
    // That combination has a real cost: a miss here is now ambiguous between the two different
    // things it can mean — tier moved (this message really was already judged elsewhere; the
    // verdict this tick is about to insert would be orphaned) or only the attempt count moved (a
    // sibling tick's unrelated content-shaped failure, CAS-incremented via `countAttempt`; this
    // message is still unjudged and the verdict in hand is the only one anyone has for it) — and
    // one PostgREST row count cannot say which. Treating every miss as certainly "raced," as a
    // bare `return 'raced'` here would, is right for the first cause and wrong for the second: it
    // would throw away a verdict this tick already paid a real, billed model call for, and leave
    // the message for a later tick to judge all over again at a further, unnecessary cost — the
    // opposite of what the attempt ceiling is for, which is bounding spend on a message that
    // keeps FAILING, not discarding one that just succeeded while a sibling's unrelated failure
    // happened to touch the same counter. So a miss here no longer bails: it falls through to the
    // write two lines down, whose own filter is `onlyIfUnjudged` alone and never touches
    // `classify_attempts`, so it cannot regress the counter either way — that write is, and was
    // always documented as, the real arbiter (see below). The price of falling through is the one
    // thing this check could do that the final write can't: skip a wasted verdict INSERT when the
    // miss really was a genuine tier race. That insert now happens on every miss, ambiguous or
    // not — an occasional orphaned row is a far cheaper mistake than a discarded, already-paid-for
    // verdict, so that is the trade made here.
    //
    // This cannot catch every race — one that lands in the gap between this check and the
    // insert two lines down still slips through, and still orphans a verdict row — but the
    // `onlyIfUnjudged` write at the end of this function is what stays correct regardless, so
    // this is a real, honest reduction in a wasted write for the plain, unraced case, not a
    // guarantee. (Skipped for a re-run: those overwrite an already-judged row on purpose, so
    // "still unjudged" does not apply, and the same overlap risk for a re-run — rare enough that
    // no two are ever in flight at once in practice — is accepted here unchanged, same as it was
    // before this fix.)
    if (!isRerun(message)) {
      const stillUnjudged = await patchMessage(
        env,
        message.id,
        { classify_attempts: message.classify_attempts },
        { onlyIfUnjudged: true, ifAttemptsEquals: message.classify_attempts },
      );
      if (stillUnjudged === 0) {
        console.error(
          `comms classifier: message ${message.id}'s freshness check missed — judged elsewhere ` +
            'or just its attempt count moved; writing the verdict below regardless',
        );
      }
    }

    const verdictId = await insertVerdict(env, {
      message_id: message.id,
      tier,
      owes_reply: verdict.owes_reply,
      ask: verdict.ask,
      reason: verdict.reason,
      provider: PROVIDER,
      model: env.CLASSIFIER_MODEL,
      prompt_version: COMMS_PROMPT_VERSION,
      rubric_version: context.rubric?.version ?? NO_RUBRIC_VERSION,
      example_set_version: context.exampleSetVersion,
      person_id: person?.id,
    });

    const rows = await patchMessage(
      env,
      message.id,
      {
        tier,
        judged_by: 'model',
        ask: verdict.ask,
        verdict_id: verdictId,
        classified_at: now.toISOString(),
        // `cleared_at` is deliberately absent: triage state belongs to the owner, so a re-run of
        // a row they already cleared re-judges it without un-clearing it.
      },
      { onlyIfUnjudged: !isRerun(message) },
    );
    if (rows === 0) {
      console.error(`comms classifier: message ${message.id} was judged by another tick first`);
      return 'raced';
    }
    if (isRerun(message)) await clearReclassifyRequest(env, message.id);
    return 'classified';
  } catch (error) {
    // The database has the last word, so a rejected write is logged and the message left unjudged
    // for the next tick. No attempt is counted: a Supabase outage is not a bad message, and
    // counting it would empty the outage into a counted tier exactly as counting transport would.
    console.error(`comms classifier: write failed for message ${message.id}`, error);
    return 'failed';
  }
}

/**
 * Run one tick. Resolves only when the sweep is finished: a scheduled invocation is torn down as
 * soon as the promise it returns settles, so anything not awaited here is killed mid-sweep.
 */
export async function runCommsSweep(env: CommsSweepEnv, now: Date): Promise<CommsSweepSummary> {
  // The credential carve-out, checked before anything else costs a request. An unset key is
  // otherwise indistinguishable from an outage, and every eligible message would take the
  // transport path forever while the queue filled with nothing.
  if (env.ANTHROPIC_API_KEY === undefined || env.ANTHROPIC_API_KEY === '') {
    console.error(`${CREDENTIAL_FAILURE}: ANTHROPIC_API_KEY is not set on this Worker`);
    await stampHealth(env, { at: now, ok: false, error: 'ANTHROPIC_API_KEY is not set' });
    return emptySummary(true);
  }

  const missing = unsetVars(env);
  if (missing.length > 0) {
    console.error(`${CONFIG_FAILURE}: ${missing.join(', ')}`);
    await stampHealth(env, { at: now, ok: false, error: `not set: ${missing.join(', ')}` });
    return emptySummary(true);
  }

  const summary = emptySummary(false);
  summary.parked += await parkAtCeiling(env, now);

  const eligible = await readEligible(env);
  summary.eligible = eligible.length;

  // Read lazily and once: a tick whose only work is parking a decode failure makes no model call
  // and needs no prompt, so it should not pay for a rubric, a roster and an example draw.
  let context: SweepContext | undefined;

  // Sequential, one request per message, deliberately — NOT Promise.all. Nobody is waiting on a
  // tick, while parallel bursts only add rate-limit risk, and one request per message is what
  // keeps a refusal or a truncation from taking out the whole batch.
  for (const message of eligible) {
    // A body that never decoded is filed without a model call: it is never judged FYI on the
    // strength of text that failed to extract, and there is no text to judge it on.
    if (!message.body_extracted) {
      const filed = await file(
        env,
        message,
        { tier: UNJUDGED_TIER, judged_by: 'unjudged', ask: UNJUDGED_DECODE_ASK },
        now,
      );
      if (filed) summary.parked += 1;
      continue;
    }

    context ??= await readContext(env);
    const account = context.accounts.get(message.account_id);
    if (account === undefined) {
      // The account row is gone, which deletes its messages by cascade — so this row is on its
      // way out. Nothing to write, nothing to count.
      console.error(`comms classifier: message ${message.id} has no account; skipping`);
      continue;
    }

    // No claim happens here before the model call — deliberately, not by oversight. Two
    // overlapping ticks CAN both dispatch a real, billed request for the same message; the loser
    // finds out only after paying, via the compare-and-set writes below. A row is never claimed
    // and abandoned, so nothing here can strand a message unjudged — the worst case is a wasted
    // Anthropic call, not a stuck row. A pre-dispatch claim was considered and rejected: the only
    // field available to CAS on without a schema change is `classify_attempts`, and every outcome
    // that must NOT count against the ceiling — transport, refusal, and a clean success — would
    // have to consume-then-revert that same counter around the call. A revert is itself a write
    // that can be lost exactly like the bug this file is fixing (a Worker evicted mid-call skips
    // it entirely), which would silently overcount attempts on the very outages and refusals this
    // module's docstring says must never count — trading a rare double-billed call for an
    // intermittent early parking of a message that never actually misbehaved. A real fix needs a
    // dedicated claim column with its own lease/timeout (so a claim a dead tick never releases is
    // still reclaimable), which is a migration — out of scope for this file.
    const outcome: JsonOutcome = await classifyJson(
      env,
      buildCommsRequest({
        message,
        account,
        rubric: context.rubric,
        examples: context.examples,
        people: context.people,
        timeZone: env.CLASSIFIER_TIMEZONE,
        now,
        // Both producers (`gmail.ts`, `ingest.ts`) write the raw header signal onto the row;
        // this is the one place it is read back off and handed to the prompt as evidence.
        carriesListHeader: message.has_list_header,
      }),
    );

    if ('failed' in outcome) {
      const { failed } = outcome;

      // The two deploy-fault reasons, which abort rather than count. Both are systemic by
      // construction — the key, the request shape and the model id are the same for every
      // message — so counting either per-message would set the whole stream aside for a fault no
      // message caused. Ingestion keeps running: this is a classifier outage, and the health row
      // is what says so in those words.
      if (failed.reason === 'credentials' || failed.reason === 'bad_request') {
        const banner = failed.reason === 'credentials' ? CREDENTIAL_FAILURE : REQUEST_FAILURE;
        console.error(`${banner}: ${failed.detail}`);
        await stampHealth(env, { at: now, ok: false, error: failed.detail });
        return { ...summary, aborted: true };
      }

      // A refusal is terminal and gets its own state: re-sending an identical prompt cannot
      // change it, so it is filed on the shelf with a visible flag rather than queued — and it
      // costs no attempt, because there is nothing to retry.
      if (failed.reason === 'refusal') {
        console.error(`comms classifier: the model refused to judge message ${message.id}`);
        const filed = await file(
          env,
          message,
          { tier: REFUSAL_TIER, judged_by: 'refusal', ask: REFUSAL_ASK },
          now,
        );
        if (filed) summary.parked += 1;
        continue;
      }

      // Transport: nothing written, nothing counted. The message stays an ordinary unjudged row
      // and the next tick is the retry — which is what keeps an Anthropic incident from
      // depositing the whole inbound stream into a counted tier inside ten minutes.
      if (failed.reason === 'transport') {
        console.error(`comms classifier: message ${message.id} not judged (transport)`);
        continue;
      }

      // Content-shaped, so one attempt is counted and the prompt is not re-asked: the same
      // prompt mostly produces the same shape.
      console.error(`comms classifier: message ${message.id} not judged (${failed.reason})`);
      await countAttempt(env, message);
      summary.failed += 1;
      continue;
    }

    const written = await writeVerdict(env, message, context, outcome.ok, now);
    if (written === 'classified') summary.classified += 1;
    else if (written === 'failed') summary.failed += 1;
  }

  await stampHealth(env, { at: now, ok: true });
  return summary;
}
