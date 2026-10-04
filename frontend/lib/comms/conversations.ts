import type { CommAccount, CommMessage } from '@/lib/types';

/**
 * The FYI shelf's unit of display: a conversation, not a message.
 *
 * A busy group chat or a long email thread otherwise puts every text and every reply on its own
 * row, and the shelf stops being skimmable. The message stays the unit of everything else —
 * triage, verdicts, the tier picker — so this is purely a view over the shelf rows, shared by the
 * server read (which never splits a conversation across a page) and the view, so the two can
 * never disagree about where one conversation ends.
 */

/**
 * The quiet gap that splits one iMessage chat into separate conversations. A chat's thread key
 * never changes, so without it sixty days of texting one person would be one row. Six hours
 * separates an evening's exchange from the next morning's but keeps an afternoon's back-and-forth
 * whole. A gap of exactly this long keeps the messages together.
 */
export const CONVERSATION_GAP_MS = 6 * 60 * 60 * 1000;

export interface ShelfConversation {
  /**
   * `'conv:'` + the oldest message's id. A newer arrival doesn't change it, so an open
   * conversation stays open through a live re-read; the prefix keeps it disjoint from message ids.
   */
  id: string;
  /** Newest → oldest, the order they are drawn in. */
  messages: CommMessage[];
  /** `messages[0]`: what the collapsed row shows. */
  newest: CommMessage;
}

/** Newest first, ties by id ascending — the order the server reads the shelf in. */
function newestFirst(a: CommMessage, b: CommMessage): number {
  const byTime = Date.parse(b.received_at) - Date.parse(a.received_at);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Group shelf rows into conversations, newest conversation first.
 *
 * A conversation is the rows that share `(account_id, thread_key)` — an email thread, or an
 * iMessage chat. An iMessage chat is additionally split wherever two consecutive shelf rows are
 * more than {@link CONVERSATION_GAP_MS} apart; email is never split by time, since a thread is
 * already a bounded unit. A row whose account is missing is treated as email.
 *
 * The gap is measured between the rows passed in only — queued and outbound rows in the same chat
 * are not consulted — which keeps the rule a pure function of the shelf.
 */
export function groupConversations(
  shelf: readonly CommMessage[],
  accounts: readonly Pick<CommAccount, 'id' | 'kind'>[],
): ShelfConversation[] {
  const splitsByTime = new Set(
    accounts.filter((account) => account.kind === 'imessage').map((account) => account.id),
  );

  // Native sort (stable, n log n) on a copy rather than the shared insertion sort: the server
  // groups a whole held shelf, which can run to thousands of rows.
  const ordered = [...shelf];
  ordered.sort(newestFirst);
  const threads = new Map<string, CommMessage[]>();
  for (const message of ordered) {
    const key = `${message.account_id}\u0000${message.thread_key}`;
    const thread = threads.get(key);
    if (thread === undefined) threads.set(key, [message]);
    else thread.push(message);
  }

  const conversations: ShelfConversation[] = [];
  for (const thread of threads.values()) {
    const splits = splitsByTime.has(thread[0]?.account_id ?? '');
    let current: CommMessage[] = [];
    for (const message of thread) {
      const previous = current.at(-1);
      if (
        splits &&
        previous !== undefined &&
        Date.parse(previous.received_at) - Date.parse(message.received_at) > CONVERSATION_GAP_MS
      ) {
        conversations.push(...toConversation(current));
        current = [];
      }
      current.push(message);
    }
    conversations.push(...toConversation(current));
  }

  conversations.sort((a, b) => newestFirst(a.newest, b.newest));
  return conversations;
}

/** One conversation from its rows, newest first — or nothing for no rows. */
function toConversation(messages: CommMessage[]): ShelfConversation[] {
  const [newest] = messages;
  const oldest = messages.at(-1);
  if (newest === undefined || oldest === undefined) return [];
  return [{ id: `conv:${oldest.id}`, messages, newest }];
}
