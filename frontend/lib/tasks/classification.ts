import type { Item } from '@/lib/types';

/**
 * Where an item's labels came from — the one bit of provenance the Inbox row renders.
 *
 * - `model` — the classifier wrote a verdict (including a verdict that abstained on every field).
 * - `claimed` — a human edited a label before the sweeper reached the row, so it is theirs.
 * - `unjudged` — nothing has judged the row: the sweeper hasn't reached it, or it exhausted its
 *   attempts. Worded as *not judged* rather than *queued* so it stays honest for both.
 */
export type ClassificationOrigin = 'model' | 'claimed' | 'unjudged';

/** The words each origin shows — the mark's accessible name and its hover title. */
export const CLASSIFICATION_ORIGIN_LABEL: Record<ClassificationOrigin, string> = {
  model: 'Labelled by the classifier',
  claimed: 'Labelled by you',
  unjudged: 'Not yet classified',
};

/**
 * Read an item's provenance off the two columns that already ride along on every row. Pure and
 * derived — nothing stores an origin, and nothing outside the row's rendering reads these columns.
 *
 * `classified_at` is checked FIRST, and the order is load-bearing. The database's
 * `items_claim_from_classifier` trigger stamps `classified_at` (leaving the provenance columns
 * null) only while `classified_at` is still null, so once the classifier has stamped a row the
 * owner's later edits never clear `classified_provider`. Reading the provider first would flip
 * such a row to "claimed"; reading the stamp first keeps it the model's, which is true — that is
 * where its labels came from.
 */
export function classificationOrigin(
  item: Pick<Item, 'classified_at' | 'classified_provider'>,
): ClassificationOrigin {
  if (item.classified_at === null) return 'unjudged';
  return item.classified_provider === null ? 'claimed' : 'model';
}
