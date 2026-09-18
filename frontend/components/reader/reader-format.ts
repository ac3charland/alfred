/**
 * The row's two formatted strings — when a post arrived, and how long it takes to read — kept
 * beside the components that draw them rather than in `lib/reader/` per the spec's own note,
 * mirroring `comms-format.ts`'s placement beside `message-row.tsx`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When a post arrived, as the list reads it: "Sep 16" for this calendar year, "Sep 16, 2025"
 * otherwise. Always a date — unlike the comms queue's clock-time-today branch, a reading list is
 * browsed at leisure, not watched for the newest arrival down to the minute.
 */
export function formatPostDate(iso: string, now: Date): string {
  const received = new Date(iso);
  const month = MONTHS[received.getMonth()] ?? '';
  const day = String(received.getDate());
  return received.getFullYear() === now.getFullYear()
    ? `${month} ${day}`
    : `${month} ${day}, ${String(received.getFullYear())}`;
}

/** The read-time estimate: a 230 words-per-minute reader, rounded up, floored at one minute. */
export function readMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 230));
}

/** The meta line's read-time clause, e.g. "14 min read". */
export function formatReadMinutes(wordCount: number): string {
  return `${String(readMinutes(wordCount))} min read`;
}
