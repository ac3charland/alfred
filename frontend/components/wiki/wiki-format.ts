import { formatElapsed } from '@/components/comms/comms-format';
import type { WikiSync } from '@/lib/types';

/**
 * The Wiki module's formatted strings — the header's sync line and a page's date — kept beside the
 * components that draw them, as `reader-format.ts` and `comms-format.ts` are. "How long ago" is
 * the app's one coarse elapsed formatter (`formatElapsed`), so "synced 2h ago" reads exactly like
 * Comms' "quiet for 2h".
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pages(count: number): string {
  return `${String(count)} page${count === 1 ? '' : 's'}`;
}

/**
 * The heading's description: how much the snapshot holds and how fresh it is, plus how many
 * changed pages the last run left for the next one ("2 pages still syncing"). Before the first
 * successful sync there is no freshness to state.
 */
export function wikiHeaderDescription(count: number, sync: WikiSync | null, now: Date): string {
  const syncedAt = sync?.synced_at ?? null;
  const freshness = syncedAt === null ? 'not synced yet' : `synced ${formatElapsed(syncedAt, now)}`;
  const pending =
    sync === null || sync.pending <= 0 ? '' : ` · ${pages(sync.pending)} still syncing`;
  return `${pages(count)} · ${freshness}${pending}`;
}

/**
 * The amber line under the heading, or `undefined` when the last run succeeded: the snapshot on
 * screen is older than the last attempt, and says how much older. Only a failure NEWER than the
 * last success counts — one the next run already recovered from is history, not news.
 */
export function wikiSyncFailureLine(sync: WikiSync | null, now: Date): string | undefined {
  const failedAt = sync?.last_error_at ?? null;
  if (sync === null || failedAt === null) return undefined;
  const syncedAt = sync.synced_at;
  if (syncedAt !== null && new Date(failedAt).getTime() <= new Date(syncedAt).getTime()) {
    return undefined;
  }
  const failed = `The last sync failed ${formatElapsed(failedAt, now)}`;
  return syncedAt === null
    ? `${failed} — nothing has synced yet.`
    : `${failed} — showing the snapshot from ${formatElapsed(syncedAt, now)}.`;
}

/**
 * A page's `updated` date as the meta row reads it, "Oct 3, 2026". The column is a calendar date
 * (`YYYY-MM-DD`), not an instant, so it is read field by field — never through `Date`, whose
 * time zone would move it a day. `undefined` for a missing or malformed date.
 */
export function formatWikiDate(date: string | null): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const month = MONTHS[Number(match?.[2]) - 1];
  if (match === null || month === undefined) return undefined;
  return `${month} ${String(Number(match[3]))}, ${match[1] ?? ''}`;
}
