import {
  makeCommAccount,
  makeCommHandle,
  makeCommMessage,
  makeCommPerson,
} from '@/lib/comms/fixtures';
import type { CommMessage, CommPersonWithHandles } from '@/lib/types';

import {
  TIER_LABEL,
  accountLabel,
  conversationLine,
  conversationWho,
  formatElapsed,
  formatMessageTime,
  senderLabel,
} from './comms-format';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

// Every instant is built from LOCAL calendar parts and read back through a local-time
// formatter, so the assertions hold in whatever zone the suite runs in (macOS locally, UTC in
// CI) rather than pinning the machine to one.
const NOW = new Date(2026, 8, 9, 12, 0);

describe('formatMessageTime', () => {
  it('shows the clock time for a message that arrived today', () => {
    expect(formatMessageTime(new Date(2026, 8, 9, 9, 14).toISOString(), NOW)).toBe('09:14');
  });

  it('pads both halves so the column stays aligned', () => {
    expect(formatMessageTime(new Date(2026, 8, 9, 8, 2).toISOString(), NOW)).toBe('08:02');
  });

  it('names yesterday rather than making the reader subtract a day', () => {
    expect(formatMessageTime(new Date(2026, 8, 8, 23, 55).toISOString(), NOW)).toBe('Yesterday');
  });

  it('falls back to a calendar date inside the same year', () => {
    expect(formatMessageTime(new Date(2026, 7, 19, 16, 30).toISOString(), NOW)).toBe('Aug 19');
  });

  it('carries the year once the message is from an earlier one', () => {
    expect(formatMessageTime(new Date(2025, 6, 16, 10, 0).toISOString(), NOW)).toBe('Jul 16, 2025');
  });

  it('renders nothing for an unparseable timestamp rather than "Invalid Date"', () => {
    expect(formatMessageTime('not a date', NOW)).toBe('');
  });
});

describe('formatElapsed', () => {
  it('calls the last minute "just now"', () => {
    expect(formatElapsed(new Date(2026, 8, 9, 11, 59, 30).toISOString(), NOW)).toBe('just now');
  });

  it('counts whole minutes under an hour', () => {
    expect(formatElapsed(new Date(2026, 8, 9, 11, 35).toISOString(), NOW)).toBe('25m ago');
  });

  it('counts whole hours under a day', () => {
    expect(formatElapsed(new Date(2026, 8, 9, 9, 0).toISOString(), NOW)).toBe('3h ago');
  });

  it('counts whole days beyond that', () => {
    expect(formatElapsed(new Date(2026, 8, 7, 9, 0).toISOString(), NOW)).toBe('2d ago');
  });

  it('treats a future timestamp as just now rather than showing negative time', () => {
    expect(formatElapsed(new Date(2026, 8, 9, 13, 0).toISOString(), NOW)).toBe('just now');
  });
});

describe('senderLabel', () => {
  const person: CommPersonWithHandles = {
    ...makeCommPerson('Dana Whitfield'),
    comm_handles: [
      {
        id: 'h1',
        person_id: 'p1',
        handle: '+15550102233',
        kind: 'phone',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  };

  it('prefers the roster name — the only name the owner chose', () => {
    const message = makeCommMessage(ACCOUNT, {
      sender_handle: '+1 (555) 010-2233',
      sender_name: 'Unknown',
    });
    expect(senderLabel(message, [person])).toBe('Dana Whitfield');
  });

  it('falls back to the sender-supplied name', () => {
    const message = makeCommMessage(ACCOUNT, {
      sender_handle: 'priya@example.com',
      sender_name: 'Priya Raghavan',
    });
    expect(senderLabel(message, [person])).toBe('Priya Raghavan');
  });

  it('falls back to the raw handle when nobody named the sender', () => {
    const message = makeCommMessage(ACCOUNT, {
      sender_handle: 'billing@northwind.co',
      sender_name: null,
    });
    expect(senderLabel(message, [])).toBe('billing@northwind.co');
  });
});

describe('accountLabel', () => {
  it('resolves the account a message came through', () => {
    const account = makeCommAccount('RealPlay');
    expect(accountLabel([account], account.id)).toEqual({ account, label: 'RealPlay' });
  });

  it('names the gap rather than rendering an empty field', () => {
    expect(accountLabel([], ACCOUNT)).toEqual({ account: undefined, label: 'unknown account' });
  });
});

describe('TIER_LABEL', () => {
  it('names all four tiers', () => {
    expect(TIER_LABEL).toEqual({
      asap: 'ASAP',
      today: 'Today',
      whenever: 'Whenever',
      fyi: 'FYI',
    });
  });
});

/** A message from `handle`, carrying `name` as its own display name. */
function from(handle: string, name: string | null, overrides: Partial<CommMessage> = {}) {
  return makeCommMessage(ACCOUNT, { sender_handle: handle, sender_name: name, ...overrides });
}

describe('conversationWho', () => {
  it('names an iMessage group chat by its chat name', () => {
    const group = { chat_name: 'Climbing crew', participants: ['+15550000001', '+15550000002'] };
    const messages = [from('+15550000001', 'Sam', group), from('+15550000002', 'Jo', group)];

    expect(conversationWho(messages, 'imessage', [])).toBe('Climbing crew');
  });

  it('names an unnamed group by up to two members, then how many more', () => {
    const members = { participants: ['+15550000001', '+15550000002', '+15550000003'] };
    const messages = [from('+15550000002', 'Jo', members), from('+15550000001', 'Sam', members)];

    // Members are labelled by the roster, else by a name the chat itself carried, else the handle.
    expect(conversationWho(messages, 'imessage', [])).toBe('Sam, Jo +1');
  });

  it('names everything else by its distinct senders, newest first, up to two then "+N"', () => {
    const dana = makeCommPerson('Dana Whitfield');
    const people: CommPersonWithHandles[] = [
      { ...dana, comm_handles: [makeCommHandle(dana.id, 'dana@example.com')] },
    ];
    const messages = [
      from('dana@example.com', 'D.'),
      from('ana@example.com', 'Ana Ruiz'),
      from('lee@example.com', 'Lee Park'),
      from('dana@example.com', 'D.'),
    ];

    expect(conversationWho(messages, 'gmail', people)).toBe('Dana Whitfield, Ana Ruiz +1');
  });

  it('does not read an email thread with several recipients as a group chat', () => {
    const cc = { participants: ['a@example.com', 'b@example.com'] };
    const messages = [from('mom@example.com', 'Mom', cc), from('mom@example.com', 'Mom', cc)];

    expect(conversationWho(messages, 'gmail', [])).toBe('Mom');
  });
});

describe('conversationLine', () => {
  it("is the newest message's line when one person sent everything", () => {
    const messages = [
      makeCommMessage(ACCOUNT, { sender_name: 'Mom', body: 'Gutters are done' }),
      makeCommMessage(ACCOUNT, { sender_name: 'Mom', body: 'Morning!' }),
    ];

    expect(conversationLine(messages, [])).toBe('Gutters are done');
  });

  it('attributes the line to the newest sender when there are several', () => {
    const messages = [
      makeCommMessage(ACCOUNT, { sender_handle: 'sam', sender_name: 'Sam', body: 'See you at 6' }),
      makeCommMessage(ACCOUNT, { sender_handle: 'jo', sender_name: 'Jo', body: 'Who is in?' }),
    ];

    expect(conversationLine(messages, [])).toBe('Sam: See you at 6');
  });
});
