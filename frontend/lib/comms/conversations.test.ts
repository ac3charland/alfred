import type { CommMessage } from '@/lib/types';

import { CONVERSATION_GAP_MS, groupConversations } from './conversations';
import { makeCommAccount, makeCommMessage, resetCommFixtureClock } from './fixtures';

const GMAIL = makeCommAccount('Personal', { id: '00000000-0000-4000-8000-00000000000a' });
const WORK = makeCommAccount('Work', { id: '00000000-0000-4000-8000-00000000000b' });
const IMESSAGE = makeCommAccount('iMessage', {
  id: '00000000-0000-4000-8000-00000000000c',
  kind: 'imessage',
});
const ACCOUNTS = [GMAIL, WORK, IMESSAGE];

const BASE = Date.parse('2026-03-01T12:00:00.000Z');

/** A shelved row `offsetMs` before {@link BASE}, in `thread` on `account`. */
function shelfRow(
  id: string,
  account: { id: string },
  thread: string,
  offsetMs: number,
  overrides: Partial<CommMessage> = {},
): CommMessage {
  return makeCommMessage(account.id, {
    id,
    thread_key: thread,
    tier: 'fyi',
    judged_by: 'model',
    received_at: new Date(BASE - offsetMs).toISOString(),
    ...overrides,
  });
}

const ids = (messages: CommMessage[]) => messages.map((message) => message.id);

beforeEach(() => {
  resetCommFixtureClock();
});

describe('groupConversations', () => {
  it('collapses shelved rows sharing an account and a thread into one conversation', () => {
    const shelf = [
      shelfRow('a1', GMAIL, 'thread-a', 0),
      shelfRow('b1', GMAIL, 'thread-b', 1000),
      shelfRow('a2', GMAIL, 'thread-a', 2000),
    ];

    const conversations = groupConversations(shelf, ACCOUNTS);

    expect(conversations.map((c) => ids(c.messages))).toEqual([['a1', 'a2'], ['b1']]);
  });

  it('keeps the same thread key on two accounts apart — a thread key is per account', () => {
    const shelf = [shelfRow('p', GMAIL, 'shared', 0), shelfRow('w', WORK, 'shared', 1000)];

    expect(groupConversations(shelf, ACCOUNTS).map((c) => ids(c.messages))).toEqual([['p'], ['w']]);
  });

  it('keeps an iMessage burst whole across a gap of exactly the threshold', () => {
    const shelf = [
      shelfRow('late', IMESSAGE, 'chat', 0),
      shelfRow('early', IMESSAGE, 'chat', CONVERSATION_GAP_MS),
    ];

    expect(groupConversations(shelf, ACCOUNTS).map((c) => ids(c.messages))).toEqual([
      ['late', 'early'],
    ]);
  });

  it('splits an iMessage chat where two shelved messages are more than the gap apart', () => {
    const shelf = [
      shelfRow('morning-2', IMESSAGE, 'chat', 0),
      shelfRow('morning-1', IMESSAGE, 'chat', 60_000),
      shelfRow('night', IMESSAGE, 'chat', 60_000 + CONVERSATION_GAP_MS + 1),
    ];

    expect(groupConversations(shelf, ACCOUNTS).map((c) => ids(c.messages))).toEqual([
      ['morning-2', 'morning-1'],
      ['night'],
    ]);
  });

  it('splits on six hours — a constant, not a setting', () => {
    expect(CONVERSATION_GAP_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('never splits an email thread by time', () => {
    const shelf = [
      shelfRow('reply', GMAIL, 'thread', 0),
      shelfRow('original', GMAIL, 'thread', 21 * 24 * 60 * 60 * 1000),
    ];

    expect(groupConversations(shelf, ACCOUNTS).map((c) => ids(c.messages))).toEqual([
      ['reply', 'original'],
    ]);
  });

  it('treats an account it cannot find as not iMessage — no time split', () => {
    const orphan = { id: '00000000-0000-4000-8000-0000000000ff' };
    const shelf = [
      shelfRow('new', orphan, 'chat', 0),
      shelfRow('old', orphan, 'chat', 3 * CONVERSATION_GAP_MS),
    ];

    expect(groupConversations(shelf, ACCOUNTS)).toHaveLength(1);
  });

  it('orders conversations by their newest message, ties broken by that id ascending', () => {
    const shelf = [
      shelfRow('z-newest', GMAIL, 'thread-z', 0),
      shelfRow('older', GMAIL, 'thread-o', 5000),
      shelfRow('m-tied', GMAIL, 'thread-m', 0),
    ];

    expect(groupConversations(shelf, ACCOUNTS).map((c) => c.newest.id)).toEqual([
      'm-tied',
      'z-newest',
      'older',
    ]);
  });

  it('draws a conversation newest first whatever order its rows arrive in', () => {
    const shelf = [
      shelfRow('first', GMAIL, 'thread', 2000),
      shelfRow('third', GMAIL, 'thread', 0),
      shelfRow('second', GMAIL, 'thread', 1000),
    ];

    const [conversation] = groupConversations(shelf, ACCOUNTS);

    expect(ids(conversation?.messages ?? [])).toEqual(['third', 'second', 'first']);
    expect(conversation?.newest.id).toBe('third');
  });

  it('names a conversation after its oldest message, so a newer arrival keeps it the same one', () => {
    const before = [shelfRow('b', GMAIL, 'thread', 1000), shelfRow('a', GMAIL, 'thread', 2000)];
    const after = [shelfRow('c', GMAIL, 'thread', 0), ...before];

    const [was] = groupConversations(before, ACCOUNTS);
    const [is] = groupConversations(after, ACCOUNTS);

    expect(was?.id).toBe('conv:a');
    expect(is?.id).toBe('conv:a');
  });
});
