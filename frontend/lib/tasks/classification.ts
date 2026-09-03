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

/**
 * Every column the classifier's write touches: the verdict's six labels, plus the provenance
 * that records who judged the row. This is the whole of what a live verdict may change in the
 * store — see {@link classifierVerdictPatch}.
 */
export type ClassifiedRow = Pick<
  Item,
  | 'id'
  | 'item_type'
  | 'priority'
  | 'due_date'
  | 'folder_id'
  | 'intended_project_id'
  | 'intended_epic_id'
  | 'classified_at'
  | 'classified_provider'
  | 'classified_model'
  | 'classified_prompt_version'
  | 'classified_guess'
  | 'classify_attempts'
>;

/**
 * What a live `items` UPDATE may write into the tasks store — the classifier's verdict, or
 * nothing. Pure, so the whole rule is one testable function rather than branches buried in a
 * subscription callback.
 *
 * The stream carries every write to the table, so the two guards are what make it safe to apply
 * a payload the tab did not ask for:
 *
 * - **A provider means a model produced it.** The claim trigger stamps `classified_at` with the
 *   provenance columns left null, so an ordinary edit, a dispatch and a human claim all arrive
 *   here indistinguishable from each other — and none of them is this store's business. The tab
 *   that made the write already applied it optimistically.
 * - **Only onto a row the tab still holds as unjudged.** `held` is the store's own copy: absent
 *   means the race rule (the row has left this store, so nothing to patch), and already-stamped
 *   means the answer on screen is either this verdict, applied, or a later one the owner chose —
 *   neither of which a re-delivered echo may overwrite.
 *
 * The patch carries the classifier's own columns and nothing else. The payload is a whole row,
 * and its title / notes / sort order could be older than an edit this tab has in flight; the six
 * label columns can be too, but only inside the one race the guards leave open — the owner
 * editing a label in the instant between the sweep's write and its delivery — and the PATCH
 * already in flight reconciles the owner's answer back on top a moment later.
 */
export function classifierVerdictPatch(
  held: Pick<Item, 'classified_at'> | undefined,
  row: ClassifiedRow,
): Partial<Item> | null {
  if (row.classified_provider === null) return null;
  if (held?.classified_at !== null) return null;
  return {
    item_type: row.item_type,
    priority: row.priority,
    due_date: row.due_date,
    folder_id: row.folder_id,
    intended_project_id: row.intended_project_id,
    intended_epic_id: row.intended_epic_id,
    classified_at: row.classified_at,
    classified_provider: row.classified_provider,
    classified_model: row.classified_model,
    classified_prompt_version: row.classified_prompt_version,
    classified_guess: row.classified_guess,
    classify_attempts: row.classify_attempts,
  };
}
