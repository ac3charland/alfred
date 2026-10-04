import { CONVERSATION_GAP_MS, groupConversations } from './conversations';
import { makeCommAccount, makeCommMessage, resetCommFixtureClock } from './fixtures';

const GMAIL = makeCommAccount('Personal Gmail', { id: '00000000-0000-4000-8000-0000000000a1' });
const WORK = makeCommAccount('Work', { id: '00000000-0000-4000-8000-0000000000a2' });
const IMESSAGE = makeCommAccount('iMessage', {
  id: '00000000-0000-4000-8000-0000000000a3',
  kind: 'imessage',
});
const ACCOUNTS = [GMAIL, WORK, IMESSAGE];

const T0 = Date.parse('2026-03-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

let sequence = 0;
/** A shelf row on `account`, `offset` ms after T0, in thread `thread`. */
function shelfRow(account: string, thread: string, offset: number, id?: string) {
  sequence += 1;
  return makeCommMessage(account, {
    id: id ?? `00000000-0000-4000-8000-00000000${String(sequence).padStart(4, '0')}`,
    thread_key: thread,
    tier: 'fyi',
    judged_by: 'model',
    received_at: new Date(T0 + offset).toISOString(),
  });
}

beforeEach(() => {
  resetCommFixtureClock();
  sequence = 0;
});

describe('groupConversations', () => {
  it('collapses messages that share an account and a thread into one conversation', () => {
    const a = shelfRow(GMAIL.id, 'thread-1', 0);
    const b = shelfRow(GMAIL.id, 'thread-1', HOUR);
    const other = shelfRow(GMAIL.id, 'thread-2', 2 * HOUR);

    const conversations = groupConversations([other, b, a], ACCOUNTS);

    expect(conversations.map((c) => c.messages.map((m) => m.id))).toEqual([
      [other.id],
      [b.id, a.id],
    ]);
  });

  it('keeps the same thread key on two accounts apart — a thread key is per account', () => {
    const personal = shelfRow(GMAIL.id, 'same', 0);
    const work = shelfRow(WORK.id, 'same', HOUR);

    expect(groupConversations([work, personal], ACCOUNTS)).toHaveLength(2);
  });

  it('splits an iMessage chat where a silence runs past the gap, and keeps exactly the gap together', () => {
    expect(CONVERSATION_GAP_MS).toBe(6 * HOUR);
    const morning = shelfRow(IMESSAGE.id, 'chat', 0);
    const exactlyGapLater = shelfRow(IMESSAGE.id, 'chat', CONVERSATION_GAP_MS);
    const oneMsPastGap = shelfRow(IMESSAGE.id, 'chat', 2 * CONVERSATION_GAP_MS + 1);

    const conversations = groupConversations([oneMsPastGap, exactlyGapLater, morning], ACCOUNTS);

    expect(conversations.map((c) => c.messages.map((m) => m.id))).toEqual([
      [oneMsPastGap.id],
      [exactlyGapLater.id, morning.id],
    ]);
  });

  it('never splits an email thread by time, however long it runs', () => {
    const first = shelfRow(GMAIL.id, 'thread', 0);
    const weeksLater = shelfRow(GMAIL.id, 'thread', 21 * 24 * HOUR);

    expect(groupConversations([weeksLater, first], ACCOUNTS)).toHaveLength(1);
  });

  it('treats a row whose account has gone missing as email: no time split', () => {
    const orphan = '00000000-0000-4000-8000-0000000000ff';
    const first = shelfRow(orphan, 'chat', 0);
    const later = shelfRow(orphan, 'chat', 3 * CONVERSATION_GAP_MS);

    expect(groupConversations([later, first], ACCOUNTS)).toHaveLength(1);
  });

  it('orders conversations by their newest message, ties broken by that message id ascending', () => {
    const older = shelfRow(GMAIL.id, 'a', 0);
    const tieHigh = shelfRow(GMAIL.id, 'b', HOUR, '00000000-0000-4000-8000-00000000000b');
    const tieLow = shelfRow(GMAIL.id, 'c', HOUR, '00000000-0000-4000-8000-00000000000a');

    const conversations = groupConversations([older, tieHigh, tieLow], ACCOUNTS);

    expect(conversations.map((c) => c.newest.id)).toEqual([tieLow.id, tieHigh.id, older.id]);
  });

  it('draws a conversation newest first, with the newest message as what the collapsed row shows', () => {
    const first = shelfRow(GMAIL.id, 'thread', 0);
    const second = shelfRow(GMAIL.id, 'thread', HOUR);
    const third = shelfRow(GMAIL.id, 'thread', 2 * HOUR);

    const [conversation] = groupConversations([second, first, third], ACCOUNTS);

    expect(conversation?.messages.map((m) => m.id)).toEqual([third.id, second.id, first.id]);
    expect(conversation?.newest).toBe(third);
  });

  it('names a conversation after its oldest message, so a newer arrival does not change it', () => {
    const first = shelfRow(GMAIL.id, 'thread', 0);
    const second = shelfRow(GMAIL.id, 'thread', HOUR);

    const [before] = groupConversations([second, first], ACCOUNTS);
    const [after] = groupConversations(
      [shelfRow(GMAIL.id, 'thread', 2 * HOUR), second, first],
      ACCOUNTS,
    );

    expect(before?.id).toBe(`conv:${first.id}`);
    expect(after?.id).toBe(before?.id);
  });

  it('holds nothing for an empty shelf', () => {
    expect(groupConversations([], ACCOUNTS)).toEqual([]);
  });
});
