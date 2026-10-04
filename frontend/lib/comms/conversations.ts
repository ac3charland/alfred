import { stableSorted } from '@/lib/sort';
import type { CommAccount, CommMessage } from '@/lib/types';

/**
 * How the FYI shelf collapses into conversations — the unit it is read in, so a busy chat or a
 * long email thread is one row rather than one row per message.
 *
 * A conversation is the shelved messages that share an account and a `thread_key`. Email is
 * never split further: a thread is already a bounded unit. An iMessage chat's key never changes,
 * though, so grouping on it alone would merge two months of texting one person into one row —
 * a chat is also split wherever two consecutive SHELVED messages are more than
 * {@link CONVERSATION_GAP_MS} apart.
 *
 * The gap is measured between shelved messages only, never queued or outbound ones, so the rule
 * is a pure function of the rows the shelf holds: the server's page completion and the view
 * group with this one function and can never disagree.
 */

/**
 * The silence that splits a chat. A gap of exactly this long keeps the messages together. Six
 * hours separates an evening's exchange from the next morning's but keeps an afternoon's
 * back-and-forth whole.
 */
export const CONVERSATION_GAP_MS = 6 * 60 * 60 * 1000;

export interface ShelfConversation {
  /**
   * `'conv:'` + the oldest message's id. A new message joining doesn't change it, so an open
   * conversation stays open through a live re-read; the prefix keeps it disjoint from message ids.
   */
  id: string;
  /** Newest → oldest, the order they are drawn in. */
  messages: CommMessage[];
  /** `messages[0]`: what the collapsed row shows. */
  newest: CommMessage;
}

/** Newest first, ties broken by id ascending — the order the server pages the shelf in. */
function byArrival(a: CommMessage, b: CommMessage): number {
  const delta = Date.parse(b.received_at) - Date.parse(a.received_at);
  if (delta !== 0) return delta;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Group shelf rows into conversations, newest conversation first. */
export function groupConversations(
  shelf: CommMessage[],
  accounts: Pick<CommAccount, 'id' | 'kind'>[],
): ShelfConversation[] {
  const splitsByTime = new Set(
    accounts.filter((account) => account.kind === 'imessage').map((account) => account.id),
  );

  // One pass over the shelf in drawn order: a conversation is created at its newest message, so
  // the list comes out ordered by newest message without a second sort.
  const groups: { newest: CommMessage; oldest: CommMessage; messages: CommMessage[] }[] = [];
  const openByThread = new Map<string, (typeof groups)[number]>();
  for (const message of stableSorted(shelf, byArrival)) {
    const key = `${message.account_id}\u0000${message.thread_key}`;
    const open = openByThread.get(key);
    const quiet =
      open !== undefined &&
      splitsByTime.has(message.account_id) &&
      Date.parse(open.oldest.received_at) - Date.parse(message.received_at) > CONVERSATION_GAP_MS;

    if (open === undefined || quiet) {
      const group = { newest: message, oldest: message, messages: [message] };
      groups.push(group);
      openByThread.set(key, group);
    } else {
      open.messages.push(message);
      open.oldest = message;
    }
  }

  return groups.map(({ newest, oldest, messages }) => ({
    id: `conv:${oldest.id}`,
    messages,
    newest,
  }));
}
