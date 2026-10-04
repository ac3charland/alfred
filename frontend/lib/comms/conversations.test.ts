import { CONVERSATION_GAP_MS, groupConversations } from './conversations';
import { makeCommAccount, makeCommMessage, resetCommFixtureClock } from './fixtures';

const GMAIL = makeCommAccount('Personal Gmail', { kind: 'gmail' });
const WORK = makeCommAccount('Work', { kind: 'imap' });
const PHONE = makeCommAccount('iMessage', { kind: 'imessage' });
const ACCOUNTS = [GMAIL, WORK, PHONE];

const BASE = Date.UTC(2026, 2, 1, 12, 0, 0);

/** A shelved message on `account` in `thread`, `minutes` after {@link BASE}. */
function at(
  account: { id: string },
  thread: string,
  minutes: number,
  overrides: Parameters<typeof makeCommMessage>[1] = {},
) {
  return makeCommMessage(account.id, {
    thread_key: thread,
    tier: 'fyi',
    received_at: new Date(BASE + minutes * 60 * 1000).toISOString(),
    ...overrides,
  });
}

/** Each conversation as its message ids, newest first. */
function ids(conversations: ReturnType<typeof groupConversations>): string[][] {
  return conversations.map((conversation) => conversation.messages.map((message) => message.id));
}

beforeEach(() => {
  resetCommFixtureClock();
});

describe('groupConversations', () => {
  it('collapses shelf rows sharing an account and thread key into one conversation', () => {
    const first = at(GMAIL, 'thread-a', 0);
    const second = at(GMAIL, 'thread-a', 10);
    const other = at(GMAIL, 'thread-b', 5);

    expect(ids(groupConversations([second, other, first], ACCOUNTS))).toEqual([
      [second.id, first.id],
      [other.id],
    ]);
  });

  it('keeps the same thread key on two accounts apart', () => {
    const mine = at(GMAIL, 'shared', 0);
    const work = at(WORK, 'shared', 1);

    expect(ids(groupConversations([work, mine], ACCOUNTS))).toEqual([[work.id], [mine.id]]);
  });

  it('keeps an iMessage chat together across a gap of exactly the threshold', () => {
    const first = at(PHONE, 'chat', 0);
    const second = makeCommMessage(PHONE.id, {
      thread_key: 'chat',
      tier: 'fyi',
      received_at: new Date(BASE + CONVERSATION_GAP_MS).toISOString(),
    });

    expect(ids(groupConversations([second, first], ACCOUNTS))).toEqual([[second.id, first.id]]);
  });

  it('splits an iMessage chat on a gap one millisecond past the threshold', () => {
    const first = at(PHONE, 'chat', 0);
    const second = makeCommMessage(PHONE.id, {
      thread_key: 'chat',
      tier: 'fyi',
      received_at: new Date(BASE + CONVERSATION_GAP_MS + 1).toISOString(),
    });

    expect(ids(groupConversations([second, first], ACCOUNTS))).toEqual([[second.id], [first.id]]);
  });

  it('never splits an email thread by time', () => {
    const old = at(GMAIL, 'thread', 0);
    const weeksLater = at(WORK, 'imap-thread', 1);
    const reply = at(GMAIL, 'thread', 60 * 24 * 21);
    const imapReply = at(WORK, 'imap-thread', 60 * 24 * 21 - 1);

    expect(ids(groupConversations([reply, imapReply, old, weeksLater], ACCOUNTS))).toEqual([
      [reply.id, old.id],
      [imapReply.id, weeksLater.id],
    ]);
  });

  it('treats a message whose account is missing as not iMessage', () => {
    const orphan = makeCommAccount('Gone', { kind: 'imessage' });
    const first = at(orphan, 'chat', 0);
    const second = at(orphan, 'chat', 60 * 24);

    expect(ids(groupConversations([second, first], ACCOUNTS))).toEqual([[second.id, first.id]]);
  });

  it('orders conversations by their newest message, ties by that message id ascending', () => {
    const tieB = at(GMAIL, 'b', 30, { id: 'bbbbbbbb-0000-4000-8000-000000000000' });
    const tieA = at(GMAIL, 'a', 30, { id: 'aaaaaaaa-0000-4000-8000-000000000000' });
    const older = at(GMAIL, 'c', 0);
    const newest = at(GMAIL, 'd', 40);
    const olderInA = at(GMAIL, 'a', 1);

    expect(ids(groupConversations([older, tieB, olderInA, tieA, newest], ACCOUNTS))).toEqual([
      [newest.id],
      [tieA.id, olderInA.id],
      [tieB.id],
      [older.id],
    ]);
  });

  it('draws a conversation newest first, with the newest as what it shows', () => {
    const first = at(GMAIL, 'thread', 0);
    const second = at(GMAIL, 'thread', 5);
    const third = at(GMAIL, 'thread', 10);

    const [conversation] = groupConversations([first, third, second], ACCOUNTS);

    expect(conversation?.messages.map((message) => message.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(conversation?.newest).toBe(third);
  });

  it('names a conversation after its oldest message, so a newer arrival keeps the id', () => {
    const first = at(PHONE, 'chat', 0);
    const second = at(PHONE, 'chat', 30);
    const before = groupConversations([second, first], ACCOUNTS);

    const third = at(PHONE, 'chat', 60);
    const after = groupConversations([third, second, first], ACCOUNTS);

    expect(before[0]?.id).toBe(`conv:${first.id}`);
    expect(after[0]?.id).toBe(`conv:${first.id}`);
  });
});
