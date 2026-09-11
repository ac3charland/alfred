import { resolvePerson } from '@/lib/comms/people';
import type { CommAccount, CommMessage, CommPersonWithHandles, CommTier } from '@/lib/types';

/**
 * The strings the queue puts on a row — who sent it, what it wants, and when it landed.
 *
 * All of it is formatted from the message plus a caller-supplied `now`, never from the clock
 * directly: the view owns one ticking instant (see `useNow`) and hands the same one to every
 * row, so a list can't render two different "now"s down its own length.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Local calendar-day key, so "today" and "yesterday" mean the owner's days, not UTC's. */
function dayKey(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * When a message arrived, as the queue says it: a clock time today, the word for yesterday,
 * and a calendar date for anything older. A queue read several times a day wants the time of
 * day for the rows that arrived during it, and a date for the rows that have been sitting.
 */
export function formatMessageTime(iso: string, now: Date): string {
  const received = new Date(iso);
  if (Number.isNaN(received.getTime())) return '';

  const today = dayKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (dayKey(received) === today)
    return `${pad(received.getHours())}:${pad(received.getMinutes())}`;
  if (dayKey(received) === dayKey(yesterday)) return 'Yesterday';

  const month = MONTHS[received.getMonth()] ?? '';
  const day = String(received.getDate());
  return received.getFullYear() === now.getFullYear()
    ? `${month} ${day}`
    : `${month} ${day}, ${String(received.getFullYear())}`;
}

/**
 * How long ago something last happened — the health surface's unit. Deliberately coarse and
 * purely elapsed: "quiet for 3h" is the whole claim a stale dot makes, and a wall-clock time
 * would ask the reader to do the subtraction themselves.
 */
export function formatElapsed(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(elapsed) || elapsed < MS_PER_MINUTE) return 'just now';
  if (elapsed < MS_PER_HOUR) return `${String(Math.floor(elapsed / MS_PER_MINUTE))}m ago`;
  if (elapsed < 24 * MS_PER_HOUR) return `${String(Math.floor(elapsed / MS_PER_HOUR))}h ago`;
  return `${String(Math.floor(elapsed / (24 * MS_PER_HOUR)))}d ago`;
}

/**
 * Who the row is from. The roster wins, because it is the only name the owner chose: the same
 * human is a phone number in iMessage and an address in three mailboxes, and a row reading
 * `+15550102233` is a row the owner has to decode. Falls back to the sender's own display name,
 * then to the raw handle — never to nothing.
 */
export function senderLabel(message: CommMessage, people: CommPersonWithHandles[]): string {
  const person = resolvePerson(message.sender_handle, people);
  if (person !== undefined) return person.name;
  const name = message.sender_name?.trim();
  return name === undefined || name === '' ? message.sender_handle : name;
}

/** The tier names as the owner reads them, section eyebrow and tier menu alike. */
export const TIER_LABEL: Record<CommTier, string> = {
  asap: 'ASAP',
  today: 'Today',
  whenever: 'Whenever',
  fyi: 'FYI',
};

/** The account a message came through, by label — the row's middle field. */
export function accountLabel(
  accounts: CommAccount[],
  accountId: string,
): { account: CommAccount | undefined; label: string } {
  const account = accounts.find((row) => row.id === accountId);
  return { account, label: account?.label ?? 'unknown account' };
}
