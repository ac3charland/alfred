/**
 * Scoring one evaluation run — pure, so the numbers can be tested without a model call.
 *
 * Two headline numbers, not one, because the classifier is deliberately biased in a DIRECTION and
 * a single accuracy figure would hide exactly the trade that bias is balanced on:
 *
 *   - queue RECALL — of the messages that should have reached the queue, how many did? A missed
 *     obligation costs the module its whole reason to exist, so this is the number that decides.
 *   - asap PRECISION — of the messages sent to asap, how many belonged there? asap is the only
 *     tier that claims "break focus", so an unearned one spends the tier's credibility, and a
 *     tier the owner stops trusting is what this module exists to prevent.
 *
 * Recall is bought where it is cheap and never where it is not, so the two are reported side by
 * side. Their opposites (queue precision, asap recall) come along to show what each cost.
 */
import type { CommTier } from '../types';
import { COMM_TIERS } from '../verdict';

/** One judgment, from either side of the comparison. */
export interface Judgment {
  queued: boolean;
  tier: CommTier;
}

/** One fixture's expected answer beside the one the model gave. */
export interface ScoredResult {
  expected: Judgment;
  actual: Judgment;
}

/** How often each expected tier was answered with each actual one. Rows expected, columns actual. */
export type Confusion = Record<CommTier, Record<CommTier, number>>;

export interface RunScore {
  /** Of everything that should have been queued, how much was. The number that decides. */
  queueRecall: number;
  /** Of everything queued, how much belonged there. What the recall bias costs. */
  queuePrecision: number;
  /** Of everything called asap, how much belonged there. The credibility of the loud tier. */
  asapPrecision: number;
  /** Of everything that was asap, how much was called that. Deliberately the softest number. */
  asapRecall: number;
  /** Exact-tier agreement. Useful, but never the headline. */
  tierAccuracy: number;
  confusion: Confusion;
}

/**
 * A rate, with the empty case answered rather than left as a division by zero.
 *
 * An empty denominator means the question does not arise — no message was called asap, so none
 * was called asap wrongly — and 1 says that without pretending the run proved anything. The
 * paired metric is what shows the miss: a run that never says asap scores an asap precision of 1
 * and an asap recall of 0, and the pair reads correctly where either alone would not.
 */
function rate(hits: number, total: number): number {
  return total === 0 ? 1 : hits / total;
}

function emptyConfusion(): Confusion {
  const rows = COMM_TIERS.map((expected) => [
    expected,
    Object.fromEntries(COMM_TIERS.map((actual) => [actual, 0])) as Record<CommTier, number>,
  ]);
  return Object.fromEntries(rows) as Confusion;
}

/** Score one run of the evaluation fixtures. */
export function scoreRun(results: readonly ScoredResult[]): RunScore {
  const confusion = emptyConfusion();

  let queuedExpected = 0;
  let queuedActual = 0;
  let queuedBoth = 0;
  let asapExpected = 0;
  let asapActual = 0;
  let asapBoth = 0;
  let exact = 0;

  for (const { expected, actual } of results) {
    confusion[expected.tier][actual.tier] += 1;

    if (expected.queued) queuedExpected += 1;
    if (actual.queued) queuedActual += 1;
    if (expected.queued && actual.queued) queuedBoth += 1;

    if (expected.tier === 'asap') asapExpected += 1;
    if (actual.tier === 'asap') asapActual += 1;
    if (expected.tier === 'asap' && actual.tier === 'asap') asapBoth += 1;

    if (expected.tier === actual.tier) exact += 1;
  }

  return {
    queueRecall: rate(queuedBoth, queuedExpected),
    queuePrecision: rate(queuedBoth, queuedActual),
    asapPrecision: rate(asapBoth, asapActual),
    asapRecall: rate(asapBoth, asapExpected),
    tierAccuracy: rate(exact, results.length),
    confusion,
  };
}

/** The confusion matrix as a fixed-width table, for the console and the saved report. */
export function renderConfusion(confusion: Confusion): string {
  const width = 10;
  const cell = (text: string): string => text.padEnd(width);
  const header = [
    String.raw`expected \ actual`.padEnd(20),
    ...COMM_TIERS.map((tier) => cell(tier)),
  ].join('');
  const rows = COMM_TIERS.map((expected) =>
    [
      expected.padEnd(20),
      ...COMM_TIERS.map((actual) => cell(String(confusion[expected][actual]))),
    ].join(''),
  );
  return [header, ...rows].join('\n');
}
