import { stableSorted } from '@/lib/sort';
import type { CommAccount, CommMessage } from '@/lib/types';

/**
 * How the FYI shelf collapses into conversations: one row per thread or chat burst instead of one
 * per message, because a busy group chat or a long email thread otherwise buries everything else
 * on the shelf under its own replies.
 *
 * A conversation is the shelved messages that share `(account_id, thread_key)` — `thread_key` is
 * per account, so the same key on two accounts is two conversations. An iMessage chat's key never
 * changes, so on an `imessage` account the set is also split wherever two consecutive shelved
 * messages are more than {@link CONVERSATION_GAP_MS} apart; otherwise sixty days of texting one
 * person would be one row. Email is never split by time: a thread is already a bounded unit.
 *
 * The gap is measured between SHELVED messages only — queued and outbound rows in the same chat are
 * not read — so the rule is a pure function of the shelf rows, and the server's page completion
 * (`readShelfPage`) and the view, which both call this, can never disagree about a boundary.
 */

/** Silence longer than this splits an iMessage chat. Exactly this long keeps it together. */
export const CONVERSATION_GAP_MS = 6 * 60 * 60 * 1000;

export interface ShelfConversation {
  /**
   * `'conv:'` + the oldest message's id. A newer message joining doesn't change it, so an open
   * conversation stays open through a live re-read; the prefix keeps it disjoint from message ids
   * in the view's `j`/`k` order.
   */
  id: string;
  /** Newest → oldest, the order they are drawn in. */
  messages: CommMessage[];
  /** `messages[0]`: what the collapsed row shows. */
  newest: CommMessage;
}

/** Newest first, ties by id ascending — the server's shelf order. */
function newestFirst(a: CommMessage, b: CommMessage): number {
  const byTime = b.received_at.localeCompare(a.received_at);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Group shelf rows into conversations, newest conversation first. */
export function groupConversations(
  shelf: CommMessage[],
  accounts: Pick<CommAccount, 'id' | 'kind'>[],
): ShelfConversation[] {
  const imessageAccounts = new Set(
    accounts.filter((account) => account.kind === 'imessage').map((account) => account.id),
  );

  const threads = new Map<string, CommMessage[]>();
  for (const message of stableSorted(shelf, newestFirst)) {
    const key = JSON.stringify([message.account_id, message.thread_key]);
    const thread = threads.get(key);
    if (thread === undefined) threads.set(key, [message]);
    else thread.push(message);
  }

  const conversations: ShelfConversation[] = [];
  for (const thread of threads.values()) {
    const splitsOnGap = imessageAccounts.has(thread[0]?.account_id ?? '');
    let current: ShelfConversation | undefined;
    for (const message of thread) {
      // The thread is walked newest first, so each message joining is the oldest so far.
      const previous = current?.messages.at(-1);
      const quietGap =
        previous !== undefined &&
        splitsOnGap &&
        Date.parse(previous.received_at) - Date.parse(message.received_at) > CONVERSATION_GAP_MS;
      if (current !== undefined && !quietGap) {
        current.messages.push(message);
        current.id = `conv:${message.id}`;
      } else {
        current = { id: `conv:${message.id}`, messages: [message], newest: message };
        conversations.push(current);
      }
    }
  }

  return stableSorted(conversations, (a, b) => newestFirst(a.newest, b.newest));
}
