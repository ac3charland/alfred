/**
 * The Inbox classifier sweep — what the cron trigger actually runs.
 *
 * One database query finds the items nobody has touched yet; each one is then classified,
 * re-validated and written back in a single coherent UPDATE, one at a time. The loop is the
 * whole retry mechanism: an item that failed is simply still unclassified on the next tick, so
 * there is no queue, no backoff state and no dead-letter — only an attempt counter, so a
 * persistent failure sets a row aside instead of looping on it forever.
 *
 * The sweep never moves anything. `dispatched_at` is absent from every payload it writes, by
 * construction, and that is the invariant that makes writing guesses onto real fields safe to
 * live with: because the machine cannot route anything anywhere, the worst a bad guess can do is
 * show a wrong chip on a row you are already looking at.
 */
import { type ClassifierEnv, classify } from './classifier';
import { PROMPT_VERSION, buildRequest, selectExamples } from './prompt';
import {
  type SupabaseEnv,
  fetchClosedWorld,
  fetchEligibleItems,
  fetchRecentCorrections,
  patchItem,
} from './supabase';
import {
  type ClosedWorld,
  type SweepItem,
  type Verdict,
  mergeIntoItem,
  validateVerdict,
} from './verdict';

/**
 * How many items one tick will take. Items over the cap are simply still unmarked next tick, so
 * deferring them is free — which makes this a more honest brake than a spend meter. At the
 * expected capture rate it is never reached in normal use; it exists so a bug cannot run away.
 */
export const SWEEP_LIMIT = 10;

/**
 * How many failures set an item aside. Enforced in the sweep PREDICATE rather than by stamping a
 * marker, so a row that exhausts its attempts goes on being an ordinary unclassified Inbox item,
 * forever if need be — the worst case equals today.
 */
export const ATTEMPT_CEILING = 5;

/** How far back the few-shot block reads. Bounded, because recency stops sorting a big log. */
export const CORRECTION_WINDOW = 60;

/** Stamped onto every verdict, so a future provider comparison is a query, not a migration. */
export const PROVIDER = 'anthropic';

/**
 * The one log line that means "the configuration is wrong, not the item". Distinct on purpose:
 * it is the first thing `wrangler tail` shows when a sweep is quietly doing nothing.
 */
export const CREDENTIAL_FAILURE = 'classifier: aborting the sweep — credential failure';

/** Everything one sweep reads from the environment. */
export interface SweepEnv extends SupabaseEnv, ClassifierEnv {
  CLASSIFIER_TIMEZONE: string;
}

/** What one tick did, for the log line and for the tests. */
export interface SweepSummary {
  eligible: number;
  classified: number;
  failed: number;
  /** True when a configuration fault stopped the tick early, leaving every item untouched. */
  aborted: boolean;
}

/**
 * Run one tick. Resolves only when the sweep is finished: a scheduled invocation is torn down
 * as soon as the promise it returns settles, so anything not awaited here is killed mid-sweep.
 */
export async function runSweep(env: SweepEnv, now: Date): Promise<SweepSummary> {
  // The credential carve-out, checked before anything else costs a request. Without it an unset
  // key is indistinguishable from a transient outage: every eligible item would burn an attempt
  // every tick, and at a two-minute cadence the whole Inbox would be past the ceiling within ten
  // minutes — permanently, since nothing resets the counter. One forgotten manual step would
  // quietly and irreversibly opt every existing capture out of the feature. Failing loudly
  // instead costs nothing but the ticks it takes to notice.
  if (env.ANTHROPIC_API_KEY === undefined || env.ANTHROPIC_API_KEY === '') {
    console.error(`${CREDENTIAL_FAILURE}: ANTHROPIC_API_KEY is not set on this Worker`);
    return { eligible: 0, classified: 0, failed: 0, aborted: true };
  }

  const items = await fetchEligibleItems(env, {
    limit: SWEEP_LIMIT,
    attemptCeiling: ATTEMPT_CEILING,
  });
  // A steady state where everything is triaged is a steady state where the model is never
  // invoked: no eligible rows means this tick cost one query and nothing else.
  if (items.length === 0) return { eligible: 0, classified: 0, failed: 0, aborted: false };

  const [world, corrections] = await Promise.all([
    fetchClosedWorld(env),
    fetchRecentCorrections(env, CORRECTION_WINDOW),
  ]);
  // Drawn once per tick, not once per item: the draw is a pure function of the rows and the live
  // world, and neither changes inside a sweep.
  const examples = selectExamples(corrections, world);

  let classified = 0;
  let failed = 0;

  // Sequential, one item per request, deliberately — NOT Promise.all. Wall time is irrelevant
  // (nobody is waiting on a tick) while parallel bursts only add rate-limit risk, and one
  // request per item is what keeps a refusal or a truncation from taking out the whole batch.
  for (const item of items) {
    const outcome = await classify(
      env,
      buildRequest({
        item,
        world,
        corrections: examples,
        timeZone: env.CLASSIFIER_TIMEZONE,
        now,
      }),
    );

    if ('failed' in outcome) {
      if (outcome.failed.reason === 'credentials') {
        console.error(`${CREDENTIAL_FAILURE}: ${outcome.failed.detail}`);
        // Every remaining item is left exactly as it was — no write, no attempt counted — so
        // fixing the key later loses nothing.
        return { eligible: items.length, classified, failed, aborted: true };
      }
      console.error(`classifier: item ${item.id} not classified (${outcome.failed.reason})`);
      // Re-sending the same prompt will not help a refusal or a truncation, and a transport
      // blip has already exhausted the client's own retries, so every one of them burns an
      // attempt rather than looping. Counting uniformly is what gives the ceiling teeth.
      await countAttempt(env, item);
      failed += 1;
      continue;
    }

    if (await writeVerdict(env, item, outcome.ok, world, now)) classified += 1;
    else failed += 1;
  }

  return { eligible: items.length, classified, failed, aborted: false };
}

/**
 * Apply one verdict as a single coherent UPDATE. All of the item's surviving guesses and all of
 * its provenance land together, because the database will reject anything else: writing a due
 * date before the type flips violates `items_task_only_fields` and fails the row.
 *
 * An abstention is still a write. A verdict where every field came back blank still stamps the
 * provenance, marking the item — eligibility is "no marker", not "still unclassified", and
 * keying on the type would re-ask the same question about the same text forever, burning budget
 * on exactly the items already known to be unjudgeable.
 */
async function writeVerdict(
  env: SweepEnv,
  item: SweepItem,
  raw: Verdict,
  world: ClosedWorld,
  now: Date,
): Promise<boolean> {
  const guess = validateVerdict(raw, world);
  try {
    const rows = await patchItem(env, item.id, {
      // Only the fields this item does not already hold — the classifier fills gaps and never
      // overwrites. `dispatched_at` is absent by construction: dispatch is a human act.
      ...mergeIntoItem(guess, item),
      classified_at: now.toISOString(),
      classified_provider: PROVIDER,
      classified_model: env.CLASSIFIER_MODEL,
      classified_prompt_version: PROMPT_VERSION,
      // The POST-validation verdict, not the raw model output, so the dispatch-time diff
      // compares like with like: a field validation dropped was never shown to the owner.
      // Abstained fields serialise away entirely, which the diff reads the same as a null.
      classified_guess: guess,
    });
    if (rows === 0) {
      // The row was deleted between the sweep query and the write. There is nothing left to
      // mark and nothing to count — the next tick simply won't see it.
      console.error(`classifier: item ${item.id} vanished before its verdict could be written`);
      return false;
    }
    return true;
  } catch (error) {
    // The database has the last word by design, so a rejected write is logged and the item is
    // left unmarked for the next tick rather than being forced through.
    console.error(`classifier: write failed for item ${item.id}`, error);
    await countAttempt(env, item);
    return false;
  }
}

/**
 * Record one failed attempt. Costs no extra read — the sweep already selected the counter, so
 * this PATCHes `n + 1` from the value in hand. Never throws: one item's bad luck must not abort
 * the sweep, and a counter that failed to increment is only ever one wasted retry.
 */
async function countAttempt(env: SweepEnv, item: SweepItem): Promise<void> {
  try {
    await patchItem(env, item.id, { classify_attempts: item.classify_attempts + 1 });
  } catch (error) {
    console.error(`classifier: could not count an attempt for item ${item.id}`, error);
  }
}
