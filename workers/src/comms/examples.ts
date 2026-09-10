/**
 * Which of the owner's corrections become the prompt's worked examples.
 *
 * The example set is the half of the policy that can't be written down — "this colleague writes
 * in a way that sounds urgent but never is" does not survive being stated as a rule — so it is
 * fed as examples beside the prose rubric rather than instead of it. Three properties make that
 * safe, and all three live here: the draw is WINDOWED (recency stops sorting a long log),
 * CAPPED (the running cost is only honest for a prompt that stops growing), and
 * DIRECTION-BALANCED.
 *
 * The balance is the load-bearing one. The classifier deliberately over-surfaces, so the
 * corrections the owner actually makes skew toward demotions — "you queued this, I'd have shelved
 * it". Drawn by recency alone, the set teaches the model to shelve more, eroding the recall bias
 * through the mechanism built to improve it, and doing it silently: a wrongly-shelved message is
 * the failure nobody sees.
 */
import type { CommExample, CommTier } from './types';

/** How many worked examples one prompt carries. */
export const EXAMPLE_LIMIT = 12;

/** How many corrections the draw reads, newest first, before choosing among them. */
export const EXAMPLE_WINDOW = 60;

/**
 * How much of one message survives into an example — roughly 150 tokens.
 *
 * An example here denormalises an EMAIL BODY, not the Inbox's one-line capture: budget 200–400
 * tokens untruncated, and a dozen of those is larger than the instructions, rubric and roster put
 * together. Truncation is what keeps the cost table describing the prompt actually being sent.
 */
export const EXAMPLE_EXCERPT_CHARS = 600;

/** Which way a correction moved the message. */
type Direction = 'promotion' | 'demotion' | 'neutral';

/** Promotions first: the direction the correction log will be poorest in gets first refusal. */
const DRAW_ORDER: readonly Direction[] = ['promotion', 'demotion', 'neutral'];

const RANK: Record<CommTier, number> = { asap: 3, today: 2, whenever: 1, fyi: 0 };

/**
 * Which way one correction moved, as the balance counts it.
 *
 * A clearing gesture ("it asked nothing") is a demotion whether or not the row it cleared carried
 * a verdict to contrast against — it is the cheapest exit a wrongly-queued message has and so the
 * most common correction of all, and counting it as neutral would let the demotion skew escape
 * the balance entirely. A correction on a row with no verdict is genuinely neutral: nothing was
 * moved, the owner simply stated the answer.
 */
function directionOf(example: CommExample): Direction {
  if (example.kind === 'nothing_to_answer') return 'demotion';
  const model = example.model_tier;
  if (model === undefined) return 'neutral';
  const moved = RANK[example.chosen_tier] - RANK[model];
  if (moved > 0) return 'promotion';
  return moved < 0 ? 'demotion' : 'neutral';
}

/** An excerpt with something left to teach: a purge nulls the text, and empty teaches nothing. */
function hasText(example: CommExample): boolean {
  return example.body_excerpt !== undefined && example.body_excerpt !== '';
}

/**
 * Re-truncate to the budget. The write already truncates, so this is defence rather than policy:
 * a row written before the budget existed, or by a path that forgot it, must not be able to
 * silently double the size of every prompt.
 */
function trimmed(example: CommExample): CommExample {
  const excerpt = example.body_excerpt;
  if (excerpt === undefined || excerpt.length <= EXAMPLE_EXCERPT_CHARS) return example;
  return { ...example, body_excerpt: excerpt.slice(0, EXAMPLE_EXCERPT_CHARS) };
}

/**
 * The examples one prompt will carry, drawn round-robin across the three directions.
 *
 * Examples with no text are dropped BEFORE the draw, not after, so a purged row never costs a
 * slot a usable one could have filled. What survives is partitioned by direction — each bucket
 * keeping the recency order it arrived in, since the store reads the window newest-first — and
 * drawn one per bucket in rotation, skipping a bucket that has run dry, until the cap is reached
 * or nothing is left. The balance is therefore a preference and not a quota: a log that only ever
 * moved one way still fills the draw.
 */
export function selectCommExamples(examples: CommExample[]): CommExample[] {
  const usable = examples.filter((example) => hasText(example)).map((example) => trimmed(example));
  const buckets: Record<Direction, CommExample[]> = {
    promotion: [],
    demotion: [],
    neutral: [],
  };
  for (const example of usable) buckets[directionOf(example)].push(example);

  const nextIndex: Record<Direction, number> = { promotion: 0, demotion: 0, neutral: 0 };
  const drawn: CommExample[] = [];
  let madeProgress = true;
  while (drawn.length < EXAMPLE_LIMIT && madeProgress) {
    madeProgress = false;
    for (const direction of DRAW_ORDER) {
      if (drawn.length >= EXAMPLE_LIMIT) break;
      const candidate = buckets[direction][nextIndex[direction]];
      if (candidate !== undefined) {
        drawn.push(candidate);
        nextIndex[direction] += 1;
        madeProgress = true;
      }
    }
  }
  return drawn;
}
