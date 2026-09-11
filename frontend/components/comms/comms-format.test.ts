import { makeCommAccount, makeCommMessage, makeCommPerson } from '@/lib/comms/fixtures';
import type { CommPersonWithHandles } from '@/lib/types';

import {
  TIER_LABEL,
  accountLabel,
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
